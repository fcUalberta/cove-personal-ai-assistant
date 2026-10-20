import { randomBytes } from "node:crypto";
import type {
  CalendarEventSummary,
  EmailSummary,
  GoogleTokens,
} from "../types.ts";
import type { EncryptedJsonStore } from "../storage/encryptedStore.ts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
];

interface GoogleConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
}

interface OAuthState {
  expiresAt: number;
}

export class GoogleIntegration {
  readonly #config: GoogleConfig;
  readonly #tokens: EncryptedJsonStore<GoogleTokens | null>;
  readonly #states = new Map<string, OAuthState>();

  constructor(config: GoogleConfig, tokenStore: EncryptedJsonStore<GoogleTokens | null>) {
    this.#config = config;
    this.#tokens = tokenStore;
  }

  isConfigured(): boolean {
    return Boolean(this.#config.clientId && this.#config.clientSecret);
  }

  async status(): Promise<{ configured: boolean; connected: boolean; email?: string }> {
    const tokens = await this.#tokens.read(null);
    return { configured: this.isConfigured(), connected: Boolean(tokens), email: tokens?.email };
  }

  createAuthorizationUrl(): string {
    if (!this.#config.clientId || !this.#config.clientSecret) {
      throw new Error("Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
    }
    const state = randomBytes(24).toString("base64url");
    this.#states.set(state, { expiresAt: Date.now() + 10 * 60_000 });
    const params = new URLSearchParams({
      client_id: this.#config.clientId,
      redirect_uri: this.#config.redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: GOOGLE_SCOPES.join(" "),
      state,
    });
    return `${AUTH_URL}?${params}`;
  }

  async handleCallback(code: string, state: string): Promise<void> {
    const pending = this.#states.get(state);
    this.#states.delete(state);
    if (!pending || pending.expiresAt < Date.now()) throw new Error("Invalid or expired OAuth state.");
    if (!this.#config.clientId || !this.#config.clientSecret) throw new Error("Google OAuth is not configured.");

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
        redirect_uri: this.#config.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!response.ok) throw new Error(`Google token exchange failed with HTTP ${response.status}.`);
    const payload = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };
    const profileResponse = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${payload.access_token}` },
    });
    const profile = profileResponse.ok ? ((await profileResponse.json()) as { email?: string }) : {};
    await this.#tokens.write({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
      scope: payload.scope,
      email: profile.email,
    });
  }

  async disconnect(): Promise<void> {
    const tokens = await this.#tokens.read(null);
    if (tokens) {
      const token = tokens.refreshToken ?? tokens.accessToken;
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }).catch(() => undefined);
    }
    await this.#tokens.write(null);
  }

  async searchEmail(query: string, maxResults = 8): Promise<EmailSummary[]> {
    const token = await this.#accessToken();
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", query);
    listUrl.searchParams.set("maxResults", String(Math.min(maxResults, 20)));
    const listResponse = await fetch(listUrl, { headers: { authorization: `Bearer ${token}` } });
    if (!listResponse.ok) throw new Error(`Gmail search failed with HTTP ${listResponse.status}.`);
    const list = (await listResponse.json()) as { messages?: Array<{ id: string; threadId: string }> };
    return Promise.all((list.messages ?? []).map(async (message) => {
      const detailUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`);
      detailUrl.searchParams.set("format", "metadata");
      for (const header of ["Subject", "From", "Date"]) detailUrl.searchParams.append("metadataHeaders", header);
      const detailResponse = await fetch(detailUrl, { headers: { authorization: `Bearer ${token}` } });
      if (!detailResponse.ok) throw new Error(`Gmail message lookup failed with HTTP ${detailResponse.status}.`);
      const detail = (await detailResponse.json()) as {
        id: string;
        threadId: string;
        snippet?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      };
      const headers = new Map((detail.payload?.headers ?? []).map((item) => [item.name.toLowerCase(), item.value]));
      return {
        id: detail.id,
        threadId: detail.threadId,
        subject: headers.get("subject") ?? "(no subject)",
        from: headers.get("from") ?? "Unknown sender",
        date: headers.get("date") ?? "",
        snippet: detail.snippet ?? "",
      };
    }));
  }

  async createDraft(args: Record<string, unknown>): Promise<unknown> {
    const token = await this.#accessToken();
    const raw = buildMimeMessage({
      to: String(args.to ?? ""),
      subject: String(args.subject ?? ""),
      body: String(args.body ?? ""),
    });
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { raw } }),
    });
    if (!response.ok) throw new Error(`Gmail draft creation failed with HTTP ${response.status}.`);
    const result = await response.json();
    return { mode: "google", ...(result as object) };
  }

  async sendMessage(args: Record<string, unknown>): Promise<unknown> {
    const token = await this.#accessToken();
    const raw = buildMimeMessage({
      to: String(args.to ?? ""),
      subject: String(args.subject ?? ""),
      body: String(args.body ?? ""),
    });
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!response.ok) throw new Error(`Gmail send failed with HTTP ${response.status}.`);
    const result = await response.json();
    return { mode: "google", sent: true, ...(result as object) };
  }

  async sendDraft(draftId: string): Promise<unknown> {
    const token = await this.#accessToken();
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts/send", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ id: draftId }),
    });
    if (!response.ok) throw new Error(`Gmail draft send failed with HTTP ${response.status}.`);
    const result = await response.json();
    return { mode: "google", sent: true, draftId, ...(result as object) };
  }

  async listUpcomingEvents(maxResults = 8): Promise<CalendarEventSummary[]> {
    const token = await this.#accessToken();
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", new Date().toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", String(Math.min(maxResults, 20)));
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Calendar lookup failed with HTTP ${response.status}.`);
    const payload = (await response.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        htmlLink?: string;
      }>;
    };
    return (payload.items ?? []).map((item) => ({
      id: item.id,
      title: item.summary ?? "Untitled event",
      start: item.start?.dateTime ?? item.start?.date ?? "",
      end: item.end?.dateTime ?? item.end?.date,
      htmlLink: item.htmlLink,
    }));
  }

  async createEvent(actionId: string, args: Record<string, unknown>): Promise<unknown> {
    const token = await this.#accessToken();
    const start = new Date(String(args.start));
    const durationMinutes = Number(args.durationMinutes ?? 60);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    const attendees = Array.isArray(args.attendees)
      ? args.attendees.map((email) => ({ email: String(email) }))
      : [];
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("sendUpdates", attendees.length ? "all" : "none");
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        id: actionId.replace(/-/g, ""),
        summary: String(args.title),
        description: String(args.description ?? "Created by Cove"),
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        attendees,
        extendedProperties: { private: { coveActionId: actionId } },
      }),
    });
    if (!response.ok) throw new Error(`Calendar event creation failed with HTTP ${response.status}.`);
    const result = await response.json();
    return { mode: "google", ...(result as object) };
  }

  async #accessToken(): Promise<string> {
    let tokens = await this.#tokens.read(null);
    if (!tokens) throw new Error("Google is not connected.");
    if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
    if (!tokens.refreshToken || !this.#config.clientId || !this.#config.clientSecret) {
      throw new Error("Google authorization expired. Reconnect Google.");
    }
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: tokens.refreshToken,
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) throw new Error("Google token refresh failed. Reconnect Google.");
    const payload = (await response.json()) as { access_token: string; expires_in: number; scope?: string };
    tokens = {
      ...tokens,
      accessToken: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
      scope: payload.scope ?? tokens.scope,
    };
    await this.#tokens.write(tokens);
    return tokens.accessToken;
  }
}

export function buildMimeMessage(input: { to: string; subject: string; body: string }): string {
  const sanitizeHeader = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
  const mime = [
    `To: ${sanitizeHeader(input.to)}`,
    `Subject: ${sanitizeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64url");
}
