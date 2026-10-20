import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import type {
  AgentRequest, DailyBrief, GoogleTokens, MeetingRecord, MemoryRecord, NoteRecord,
  ProposedAction, ReminderRecord,
} from "./types.ts";
import { EncryptedJsonStore } from "./storage/encryptedStore.ts";
import { OpenAICompatibleProvider } from "./agent/models.ts";
import { AgentOrchestrator } from "./agent/orchestrator.ts";
import { GoogleIntegration } from "./integrations/google.ts";
import { ActionExecutor } from "./agent/executor.ts";

const config = loadConfig();
const execFile = promisify(execFileCallback);
const webDirectory = fileURLToPath(new URL("./web", import.meta.url));
const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const voicePython = join(projectDirectory, ".venv", "bin", "python");
const voiceScript = join(projectDirectory, "scripts", "transcribe-local.py");
const voiceModelDirectory = join(projectDirectory, ".cache", "whisper");
const voiceModelFile = join(voiceModelDirectory, "base.en.pt");
const keyPath = join(config.dataDirectory, "local.key");
const store = <T>(name: string) => new EncryptedJsonStore<T>(join(config.dataDirectory, `${name}.enc.json`), keyPath);
const memoryStore = store<MemoryRecord[]>("memories");
const actionStore = store<ProposedAction[]>("actions");
const noteStore = store<NoteRecord[]>("notes");
const reminderStore = store<ReminderRecord[]>("reminders");
const meetingStore = store<MeetingRecord[]>("meetings");
const googleTokenStore = store<GoogleTokens | null>("google-tokens");

const localModel = new OpenAICompatibleProvider({
  name: "local model", baseUrl: config.localModel.baseUrl, model: config.localModel.model,
});
const cloudModel = config.cloudModel.model
  ? new OpenAICompatibleProvider({
      name: "cloud model", baseUrl: config.cloudModel.baseUrl,
      model: config.cloudModel.model, apiKey: config.cloudModel.apiKey,
    })
  : undefined;
const google = new GoogleIntegration(config.google, googleTokenStore);
const executor = new ActionExecutor(google);
const agent = new AgentOrchestrator({
  localModel, cloudModel, cloudEnabled: config.cloudModel.enabled,
  readMemories: () => memoryStore.read([]), writeMemories: (value) => memoryStore.write(value),
  readActions: () => actionStore.read([]), writeActions: (value) => actionStore.write(value),
  executeAction: (action) => executor.execute(action),
});

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const body = await readBody(request, 2 * 1024 * 1024);
  try { return JSON.parse(body.toString("utf8")) as T; }
  catch { throw new HttpError(400, "Invalid JSON body."); }
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new HttpError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function voiceAvailable(): Promise<boolean> {
  try { await Promise.all([access(voicePython), access(voiceScript), access(voiceModelFile)]); return true; }
  catch { return false; }
}

async function transcribeLocally(request: IncomingMessage): Promise<string> {
  if (!(await voiceAvailable())) throw new HttpError(503, "Local speech model is not installed.");
  const audio = await readBody(request, 25 * 1024 * 1024);
  if (!audio.length) throw new HttpError(400, "No audio was received.");
  const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0];
  const extension = contentType.includes("mp4") ? ".m4a" : contentType.includes("ogg") ? ".ogg" : ".webm";
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "cove-voice-"));
  const audioPath = join(temporaryDirectory, `recording${extension}`);
  try {
    await writeFile(audioPath, audio);
    const { stdout } = await execFile(voicePython, [voiceScript, audioPath, voiceModelDirectory], {
      cwd: projectDirectory, timeout: 180_000, maxBuffer: 2 * 1024 * 1024,
    });
    const lines = stdout.trim().split(/\r?\n/);
    const result = JSON.parse(lines.at(-1) || "{}") as { text?: unknown };
    return typeof result.text === "string" ? result.text.trim() : "";
  } catch (error) {
    console.error("Local transcription failed:", error);
    throw new HttpError(500, "Local transcription failed. Please try a shorter recording.");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location, "cache-control": "no-store" });
  response.end();
}

async function buildDailyBrief(): Promise<DailyBrief> {
  const [reminders, actions, googleStatus] = await Promise.all([
    reminderStore.read([]), actionStore.read([]), google.status(),
  ]);
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60_000);
  const due = reminders
    .filter((item) => !item.completed && (!item.dueAt || new Date(item.dueAt) <= horizon))
    .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  const calendar = googleStatus.connected ? await google.listUpcomingEvents(6).catch(() => []) : [];
  const pendingActions = actions.filter((item) => item.status === "pending");
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const pieces = [
    calendar.length ? `${calendar.length} upcoming calendar ${calendar.length === 1 ? "event" : "events"}` : "no connected calendar events",
    due.length ? `${due.length} open ${due.length === 1 ? "reminder" : "reminders"}` : "no reminders due",
    pendingActions.length ? `${pendingActions.length} ${pendingActions.length === 1 ? "action" : "actions"} awaiting approval` : "nothing awaiting approval",
  ];
  return {
    generatedAt: now.toISOString(), greeting, calendar, reminders: due, pendingActions,
    summary: `${greeting}. You have ${pieces.join(", ")}.`,
  };
}

async function summarizeMeeting(title: string, transcript: string): Promise<Pick<MeetingRecord, "summary" | "actionItems">> {
  if (!transcript.trim()) return { summary: "No transcript was provided.", actionItems: [] };
  if (await localModel.isAvailable()) {
    const output = await localModel.generate([
      {
        role: "system",
        content: "Summarize meeting transcripts. Return strict JSON with keys summary (string) and actionItems (array of strings). Do not invent facts, owners, or deadlines.",
      },
      { role: "user", content: `Meeting: ${title}\n\nTranscript:\n${transcript.slice(0, 20_000)}` },
    ]);
    const match = output.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as { summary?: unknown; actionItems?: unknown };
        if (typeof parsed.summary === "string" && Array.isArray(parsed.actionItems)) {
          return {
            summary: parsed.summary,
            actionItems: parsed.actionItems.filter((item): item is string => typeof item === "string").slice(0, 12),
          };
        }
      } catch { /* fall through */ }
    }
  }
  const sentences = transcript.split(/(?<=[.!?])\s+/).filter(Boolean);
  const actionItems = transcript.split(/\r?\n/)
    .filter((line) => /\b(action|todo|follow up|will|need to)\b/i.test(line))
    .map((line) => line.replace(/^[-*\s]+/, "").trim()).filter(Boolean).slice(0, 10);
  return { summary: sentences.slice(0, 4).join(" ").slice(0, 1_200), actionItems };
}

async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    const [googleStatus, notes, reminders, meetings, localVoiceAvailable] = await Promise.all([
      google.status(), noteStore.read([]), reminderStore.read([]), meetingStore.read([]), voiceAvailable(),
    ]);
    return json(response, 200, {
      ok: true, localModelAvailable: await localModel.isAvailable(), localModel: config.localModel.model,
      cloudEscalationEnabled: config.cloudModel.enabled, cloudConfigured: Boolean(cloudModel),
      localVoiceAvailable, localVoiceModel: "Whisper base.en",
      google: googleStatus, counts: { notes: notes.length, reminders: reminders.length, meetings: meetings.length },
    });
  }
  if (request.method === "POST" && url.pathname === "/api/voice/transcribe") {
    const text = await transcribeLocally(request);
    return json(response, 200, { text });
  }
  if (request.method === "GET" && url.pathname === "/api/brief") return json(response, 200, await buildDailyBrief());
  if (request.method === "GET" && url.pathname === "/api/memories") return json(response, 200, await memoryStore.read([]));

  const memoryMatch = url.pathname.match(/^\/api\/memories\/([^/]+)$/);
  if (memoryMatch && request.method === "PATCH") {
    const body = await readJson<{ value?: string }>(request);
    const memories = await memoryStore.read([]);
    const memory = memories.find((item) => item.id === memoryMatch[1]);
    if (!memory) throw new HttpError(404, "Memory not found.");
    if (typeof body.value === "string" && body.value.trim()) memory.value = body.value.trim();
    memory.updatedAt = new Date().toISOString();
    await memoryStore.write(memories);
    return json(response, 200, memory);
  }
  if (memoryMatch && request.method === "DELETE") {
    const memories = await memoryStore.read([]);
    const filtered = memories.filter((item) => item.id !== memoryMatch[1]);
    if (filtered.length === memories.length) throw new HttpError(404, "Memory not found.");
    await memoryStore.write(filtered);
    return json(response, 200, { deleted: true });
  }

  if (request.method === "GET" && url.pathname === "/api/actions") return json(response, 200, await actionStore.read([]));
  if (request.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson<AgentRequest>(request);
    if (!body || typeof body.message !== "string") throw new HttpError(400, "message is required");
    return json(response, 200, await agent.handle({
      message: body.message, privacyMode: body.privacyMode === "balanced" ? "balanced" : "local-only",
    }));
  }
  const decisionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/(approve|reject)$/);
  if (request.method === "POST" && decisionMatch) {
    return json(response, 200, await agent.decideAction(decodeURIComponent(decisionMatch[1]), decisionMatch[2] as "approve" | "reject"));
  }

  if (request.method === "GET" && url.pathname === "/api/notes") return json(response, 200, await noteStore.read([]));
  if (request.method === "POST" && url.pathname === "/api/notes") {
    const body = await readJson<{ title?: string; content?: string; tags?: string[] }>(request);
    if (!body.title?.trim() && !body.content?.trim()) throw new HttpError(400, "A title or content is required.");
    const now = new Date().toISOString();
    const note: NoteRecord = {
      id: randomUUID(), title: body.title?.trim() || "Untitled note", content: body.content?.trim() ?? "",
      tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 10) : [], createdAt: now, updatedAt: now,
    };
    const notes = await noteStore.read([]); notes.push(note); await noteStore.write(notes);
    return json(response, 201, note);
  }
  const noteMatch = url.pathname.match(/^\/api\/notes\/([^/]+)$/);
  if (noteMatch && request.method === "PATCH") {
    const body = await readJson<Partial<Pick<NoteRecord, "title" | "content" | "tags">>>(request);
    const notes = await noteStore.read([]);
    const note = notes.find((item) => item.id === noteMatch[1]);
    if (!note) throw new HttpError(404, "Note not found.");
    if (typeof body.title === "string" && body.title.trim()) note.title = body.title.trim();
    if (typeof body.content === "string") note.content = body.content;
    if (Array.isArray(body.tags)) note.tags = body.tags.map(String).slice(0, 10);
    note.updatedAt = new Date().toISOString(); await noteStore.write(notes);
    return json(response, 200, note);
  }
  if (noteMatch && request.method === "DELETE") {
    const notes = await noteStore.read([]); const filtered = notes.filter((item) => item.id !== noteMatch[1]);
    if (filtered.length === notes.length) throw new HttpError(404, "Note not found.");
    await noteStore.write(filtered); return json(response, 200, { deleted: true });
  }

  if (request.method === "GET" && url.pathname === "/api/reminders") return json(response, 200, await reminderStore.read([]));
  if (request.method === "POST" && url.pathname === "/api/reminders") {
    const body = await readJson<{ title?: string; dueAt?: string }>(request);
    if (!body.title?.trim()) throw new HttpError(400, "Reminder title is required.");
    if (body.dueAt && Number.isNaN(Date.parse(body.dueAt))) throw new HttpError(400, "Reminder date is invalid.");
    const now = new Date().toISOString();
    const reminder: ReminderRecord = {
      id: randomUUID(), title: body.title.trim(), dueAt: body.dueAt || undefined,
      completed: false, createdAt: now, updatedAt: now,
    };
    const reminders = await reminderStore.read([]); reminders.push(reminder); await reminderStore.write(reminders);
    return json(response, 201, reminder);
  }
  const reminderMatch = url.pathname.match(/^\/api\/reminders\/([^/]+)$/);
  if (reminderMatch && request.method === "PATCH") {
    const body = await readJson<Partial<Pick<ReminderRecord, "title" | "dueAt" | "completed">>>(request);
    const reminders = await reminderStore.read([]);
    const reminder = reminders.find((item) => item.id === reminderMatch[1]);
    if (!reminder) throw new HttpError(404, "Reminder not found.");
    if (typeof body.title === "string" && body.title.trim()) reminder.title = body.title.trim();
    if (typeof body.dueAt === "string" && !Number.isNaN(Date.parse(body.dueAt))) reminder.dueAt = body.dueAt;
    if (typeof body.completed === "boolean") reminder.completed = body.completed;
    reminder.updatedAt = new Date().toISOString(); await reminderStore.write(reminders);
    return json(response, 200, reminder);
  }
  if (reminderMatch && request.method === "DELETE") {
    const reminders = await reminderStore.read([]); const filtered = reminders.filter((item) => item.id !== reminderMatch[1]);
    if (filtered.length === reminders.length) throw new HttpError(404, "Reminder not found.");
    await reminderStore.write(filtered); return json(response, 200, { deleted: true });
  }

  if (request.method === "GET" && url.pathname === "/api/meetings") return json(response, 200, await meetingStore.read([]));
  if (request.method === "POST" && url.pathname === "/api/meetings") {
    const body = await readJson<{ title?: string; transcript?: string }>(request);
    if (!body.transcript?.trim()) throw new HttpError(400, "Meeting transcript is required.");
    const result = await summarizeMeeting(body.title?.trim() || "Meeting", body.transcript);
    const meeting: MeetingRecord = {
      id: randomUUID(), title: body.title?.trim() || "Meeting", transcript: body.transcript.trim(),
      summary: result.summary, actionItems: result.actionItems, createdAt: new Date().toISOString(),
    };
    const meetings = await meetingStore.read([]); meetings.push(meeting); await meetingStore.write(meetings);
    return json(response, 201, meeting);
  }
  const meetingMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)$/);
  if (meetingMatch && request.method === "DELETE") {
    const meetings = await meetingStore.read([]); const filtered = meetings.filter((item) => item.id !== meetingMatch[1]);
    if (filtered.length === meetings.length) throw new HttpError(404, "Meeting not found.");
    await meetingStore.write(filtered); return json(response, 200, { deleted: true });
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/google/status") return json(response, 200, await google.status());
  if (request.method === "GET" && url.pathname === "/api/integrations/google/connect") return redirect(response, google.createAuthorizationUrl());
  if (request.method === "GET" && url.pathname === "/api/integrations/google/callback") {
    const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
    if (!code || !state) throw new HttpError(400, "Google callback is missing code or state.");
    await google.handleCallback(code, state); return redirect(response, "/?view=settings&google=connected");
  }
  if (request.method === "POST" && url.pathname === "/api/integrations/google/disconnect") {
    await google.disconnect(); return json(response, 200, { disconnected: true });
  }
  if (request.method === "GET" && url.pathname === "/api/email/search") {
    const status = await google.status();
    if (!status.connected) throw new HttpError(409, "Connect Google before searching Gmail.");
    return json(response, 200, await google.searchEmail(url.searchParams.get("q") || "newer_than:7d"));
  }
  if (request.method === "GET" && url.pathname === "/api/calendar/upcoming") {
    const status = await google.status();
    if (!status.connected) return json(response, 200, []);
    return json(response, 200, await google.listUpcomingEvents());
  }

  if (request.method === "GET") {
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (requested.includes("..")) throw new HttpError(400, "Invalid path");
    try {
      const filePath = join(webDirectory, requested); const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
        "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'",
        "x-frame-options": "DENY", "x-content-type-options": "nosniff",
      });
      return response.end(body);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      throw new HttpError(404, "Not found");
    }
  }
  throw new HttpError(404, "Not found");
}

const server = createServer((request, response) => {
  handler(request, response).catch((error) => {
    console.error(error);
    const status = error instanceof HttpError ? error.status : 500;
    if (!response.headersSent) json(response, status, { error: (error as Error).message });
    else response.end();
  });
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Cove Private Agent is running at http://127.0.0.1:${config.port}`);
});
