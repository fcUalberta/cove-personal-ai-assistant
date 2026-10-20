export type RiskLevel = "observe" | "prepare" | "reversible" | "external" | "high";

export type PrivacyMode = "local-only" | "balanced";

export interface MemoryRecord {
  id: string;
  kind: "preference" | "person" | "project" | "routine" | "fact";
  value: string;
  source: "explicit-user" | "confirmed-inference";
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteRecord {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ReminderRecord {
  id: string;
  title: string;
  dueAt?: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingRecord {
  id: string;
  title: string;
  transcript: string;
  summary: string;
  actionItems: string[];
  createdAt: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
  email?: string;
}

export interface CalendarEventSummary {
  id: string;
  title: string;
  start: string;
  end?: string;
  htmlLink?: string;
}

export interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface ProposedAction {
  id: string;
  tool: string;
  title: string;
  summary: string;
  risk: RiskLevel;
  args: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "completed" | "failed";
  createdAt: string;
  result?: unknown;
}

export interface AgentRequest {
  message: string;
  privacyMode: PrivacyMode;
}

export interface AgentResponse {
  text: string;
  source: "local" | "cloud" | "workflow";
  proposedActions: ProposedAction[];
  privacyNotice?: string;
}

export interface DailyBrief {
  generatedAt: string;
  greeting: string;
  calendar: CalendarEventSummary[];
  reminders: ReminderRecord[];
  pendingActions: ProposedAction[];
  summary: string;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelProvider {
  readonly name: string;
  generate(messages: ModelMessage[]): Promise<string>;
  isAvailable(): Promise<boolean>;
}
