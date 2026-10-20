import { randomUUID } from "node:crypto";
import type {
  AgentRequest,
  AgentResponse,
  MemoryRecord,
  ModelProvider,
  ProposedAction,
} from "../types.ts";
import { minimizeForCloud } from "../security/redact.ts";
import { actionRequiresApproval, validateAction } from "./policy.ts";
import { proposeAction } from "./tools.ts";

interface AgentDependencies {
  localModel: ModelProvider;
  cloudModel?: ModelProvider;
  cloudEnabled: boolean;
  readMemories(): Promise<MemoryRecord[]>;
  writeMemories(memories: MemoryRecord[]): Promise<void>;
  readActions(): Promise<ProposedAction[]>;
  writeActions(actions: ProposedAction[]): Promise<void>;
  executeAction(action: ProposedAction): Promise<unknown>;
}

const SYSTEM_PROMPT = `You are a private personal assistant. Be concise and grounded in the supplied context.
Never claim an external action was completed unless the application reports a successful tool result.
Do not ask for passwords, API keys, full payment card numbers, or authentication codes.`;

export class AgentOrchestrator {
  readonly #deps: AgentDependencies;

  constructor(dependencies: AgentDependencies) {
    this.#deps = dependencies;
  }

  async handle(request: AgentRequest): Promise<AgentResponse> {
    const message = request.message.trim();
    if (!message) return { text: "Tell me what you need.", source: "workflow", proposedActions: [] };

    const memories = await this.#deps.readMemories();
    const remembered = this.#parseExplicitMemory(message);
    if (remembered) {
      const now = new Date().toISOString();
      memories.push({
        id: randomUUID(),
        kind: "preference",
        value: remembered,
        source: "explicit-user",
        confidence: 1,
        createdAt: now,
        updatedAt: now,
      });
      await this.#deps.writeMemories(memories);
      return {
        text: `I saved this locally: “${remembered}”`,
        source: "workflow",
        proposedActions: [],
      };
    }

    const existingActions = await this.#deps.readActions();
    if (isSendFollowUp(message)) {
      const pendingSend = [...existingActions].reverse().find(
        (item) => ["email.send", "email.send_draft"].includes(item.tool) && item.status === "pending",
      );
      if (pendingSend) {
        return {
          text: "The email is ready and waiting for your approval. Review its contents and press Approve in Activity to send it.",
          source: "workflow",
          proposedActions: [pendingSend],
        };
      }
    }
    const action = this.#parseAction(message, existingActions);
    if (action) {
      const errors = validateAction(action);
      if (errors.length) {
        return { text: `I need more information: ${errors.join(" ")}`, source: "workflow", proposedActions: [] };
      }

      if (!actionRequiresApproval(action)) {
        action.result = await this.#deps.executeAction(action);
        action.status = "completed";
      }
      existingActions.push(action);
      await this.#deps.writeActions(existingActions);
      return {
        text: actionRequiresApproval(action)
          ? "I prepared the action but have not executed it. Review and approve it below."
          : "I prepared a private draft. No message was sent.",
        source: "workflow",
        proposedActions: [action],
      };
    }

    if (looksLikeEmailSendRequest(message)) {
      return {
        text: "I have not sent anything. I need a recipient email address and message content before I can prepare a send action for your approval.",
        source: "workflow",
        proposedActions: [],
      };
    }

    const relevant = memories.slice(-8).map((item) => item.value);
    if (await this.#deps.localModel.isAvailable()) {
      const text = await this.#deps.localModel.generate([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: `Confirmed local memories:\n${relevant.map((x) => `- ${x}`).join("\n") || "None"}` },
        { role: "user", content: message },
      ]);
      return { text, source: "local", proposedActions: [] };
    }

    if (
      request.privacyMode === "balanced" &&
      this.#deps.cloudEnabled &&
      this.#deps.cloudModel &&
      (await this.#deps.cloudModel.isAvailable())
    ) {
      const minimized = minimizeForCloud(message, relevant);
      const text = await this.#deps.cloudModel.generate([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: minimized.text },
      ]);
      return {
        text,
        source: "cloud",
        proposedActions: [],
        privacyNotice: minimized.redactions.length
          ? `Redacted before cloud use: ${[...new Set(minimized.redactions)].join(", ")}.`
          : "Only the current request and selected confirmed preferences were sent.",
      };
    }

    return {
      text:
        "The private workflow engine is running, but no local model is connected. Start a local OpenAI-compatible server or ask me to remember something, draft an email, or prepare a calendar event.",
      source: "workflow",
      proposedActions: [],
    };
  }

  async decideAction(id: string, decision: "approve" | "reject"): Promise<ProposedAction> {
    const actions = await this.#deps.readActions();
    const action = actions.find((item) => item.id === id);
    if (!action) throw new Error("Action not found.");
    if (action.status !== "pending") throw new Error("Action was already decided.");

    if (decision === "reject") {
      action.status = "rejected";
    } else {
      action.status = "approved";
      try {
        action.result = await this.#deps.executeAction(action);
        action.status = "completed";
      } catch (error) {
        action.status = "failed";
        action.result = { error: (error as Error).message };
      }
    }

    await this.#deps.writeActions(actions);
    return action;
  }

  #parseExplicitMemory(message: string): string | undefined {
    const match = message.match(/^(?:remember(?: that)?|my preference is)\s+(.+)$/i);
    return match?.[1]?.trim();
  }

  #parseAction(message: string, existingActions: ProposedAction[]): ProposedAction | undefined {
    if (isSendFollowUp(message)) {
      const draft = [...existingActions].reverse().find((item) => item.tool === "email.create_draft" && item.status !== "rejected");
      if (draft) {
        const result = draft.result && typeof draft.result === "object" ? draft.result as Record<string, unknown> : undefined;
        const draftId = result?.mode === "google" && typeof result.id === "string" ? result.id : undefined;
        return proposeAction({
          tool: draftId ? "email.send_draft" : "email.send",
          title: "Send email",
          summary: `Send the prepared email${draft.args.to ? ` to ${String(draft.args.to)}` : ""}.`,
          risk: "external",
          args: draftId ? { draftId, to: draft.args.to } : { ...draft.args },
        });
      }
    }

    const sendEmail = parseDirectEmailSend(message);
    if (sendEmail) {
      return proposeAction({
        tool: "email.send",
        title: "Send email",
        summary: `Send an email to ${sendEmail.to}.`,
        risk: "external",
        args: { to: sendEmail.to, subject: sendEmail.subject, body: sendEmail.body },
      });
    }

    const email = message.match(/^draft (?:a |an )?(?:(warm|friendly|formal|concise|casual|professional) )?email(?: to ([^:]+))?(?::| saying)?\s*(.+)$/i);
    if (email) {
      return proposeAction({
        tool: "email.create_draft",
        title: "Create email draft",
        summary: `Draft ${email[1] ? `a ${email[1]} ` : "an "}email${email[2] ? ` to ${email[2].trim()}` : ""}.`,
        risk: "reversible",
        args: { to: email[2]?.trim() ?? "", subject: "", body: email[3].trim(), tone: email[1] ?? "default" },
      });
    }

    const messageDraft = message.match(/^draft (?:a )?(?:text|message)(?: to ([^:]+))?(?::| saying)?\s*(.+)$/i);
    if (messageDraft) {
      return proposeAction({
        tool: "message.prepare",
        title: "Prepare message",
        summary: `Prepare a message${messageDraft[1] ? ` to ${messageDraft[1].trim()}` : ""}.`,
        risk: "prepare",
        args: { to: messageDraft[1]?.trim() ?? "", body: messageDraft[2].trim() },
      });
    }

    const relativeCalendar = message.match(
      /^(?:create|schedule|add) (?:a )?(?:calendar )?(?:event|meeting) (?:called |for )?"?(.+?)"?\s+(today|tomorrow)\s+at\s+(.+)$/i,
    );
    const standardCalendar = message.match(
      /^(?:create|schedule|add) (?:a )?(?:calendar )?(?:event|meeting) (?:called |for )?"?([^"@]+?)"?\s+(?:at|on)\s+(.+)$/i,
    );
    const calendar = relativeCalendar
      ? [relativeCalendar[0], relativeCalendar[1], `${relativeCalendar[2]} at ${relativeCalendar[3]}`]
      : standardCalendar;
    if (calendar) {
      const start = parseDate(calendar[2].trim());
      return proposeAction({
        tool: "calendar.create_event",
        title: "Create calendar event",
        summary: `${calendar[1].trim()} at ${calendar[2].trim()}`,
        risk: "reversible",
        args: {
          title: calendar[1].trim(),
          start: Number.isNaN(start.getTime()) ? calendar[2].trim() : start.toISOString(),
        },
      });
    }

    return undefined;
  }
}

function parseDate(value: string): Date {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const relative = value.match(/^(today|tomorrow)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!relative) return direct;
  const date = new Date();
  if (relative[1].toLowerCase() === "tomorrow") date.setDate(date.getDate() + 1);
  let hour = Number(relative[2]);
  const meridiem = relative[4]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  date.setHours(hour, Number(relative[3] ?? 0), 0, 0);
  return date;
}

function isSendFollowUp(message: string): boolean {
  return /^(?:(?:can|could|would) you\s+|you can\s+|please\s+)?(?:send|send it|send that|send the (?:draft|email)|go ahead and send(?: it)?)[?.!]*$/i.test(message.trim());
}

function parseDirectEmailSend(message: string): { to: string; subject: string; body: string } | undefined {
  const intent = message.match(/(?:send|write and send|compose and send)\s+(?:an?\s+)?email\s+to\s+([^\s,;]+@[^\s,;]+)/i);
  if (!intent || intent.index === undefined) return undefined;
  let remainder = message.slice(intent.index + intent[0].length).trim();
  remainder = remainder.replace(/^[\s,:;–—-]*(?:(?:saying|with (?:the )?message|task)\s*[:;–—-]?\s*)?/i, "").trim();
  if (!remainder) return undefined;
  const subjectMatch = remainder.match(/^subject\s*[:–—-]\s*([^\n]+)\n+([\s\S]+)$/i);
  return {
    to: intent[1].replace(/[.?!]+$/, ""),
    subject: subjectMatch?.[1]?.trim() ?? "",
    body: subjectMatch?.[2]?.trim() ?? remainder,
  };
}

function looksLikeEmailSendRequest(message: string): boolean {
  return /\b(?:send|sent)\b[\s\S]*\b(?:email|it|that)\b/i.test(message)
    || /\b(?:email)\b[\s\S]*\b(?:send|sent)\b/i.test(message);
}
