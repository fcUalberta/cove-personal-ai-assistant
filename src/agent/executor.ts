import { randomUUID } from "node:crypto";
import type { ProposedAction } from "../types.ts";
import type { GoogleIntegration } from "../integrations/google.ts";

export class ActionExecutor {
  readonly #google: GoogleIntegration;

  constructor(google: GoogleIntegration) {
    this.#google = google;
  }

  async execute(action: ProposedAction): Promise<unknown> {
    const googleStatus = await this.#google.status();
    switch (action.tool) {
      case "email.create_draft":
        if (googleStatus.connected) return this.#google.createDraft(action.args);
        return {
          draftId: `local_draft_${randomUUID()}`,
          mode: "local-only",
          notice: "Saved as a local draft because Google is not connected.",
          ...action.args,
        };
      case "email.send":
        if (!googleStatus.connected) throw new Error("Connect Google before sending email.");
        return this.#google.sendMessage(action.args);
      case "email.send_draft":
        if (!googleStatus.connected) throw new Error("Connect Google before sending email.");
        return this.#google.sendDraft(String(action.args.draftId ?? ""));
      case "calendar.create_event":
        if (googleStatus.connected) return this.#google.createEvent(action.id, action.args);
        return {
          eventId: `local_event_${randomUUID()}`,
          mode: "local-only",
          notice: "Saved as a local event proposal because Google is not connected.",
          ...action.args,
        };
      case "message.prepare":
        return {
          messageId: `local_message_${randomUUID()}`,
          mode: "local-only",
          notice: "Prepared locally. Cove did not send a message.",
          ...action.args,
        };
      default:
        throw new Error(`Unknown tool: ${action.tool}`);
    }
  }
}
