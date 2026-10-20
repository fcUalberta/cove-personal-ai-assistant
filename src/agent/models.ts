import type { ModelMessage, ModelProvider } from "../types.ts";

export class OpenAICompatibleProvider implements ModelProvider {
  readonly name: string;
  readonly #baseUrl?: string;
  readonly #model: string;
  readonly #apiKey?: string;

  constructor(options: { name: string; baseUrl?: string; model: string; apiKey?: string }) {
    this.name = options.name;
    this.#baseUrl = options.baseUrl?.replace(/\/$/, "");
    this.#model = options.model;
    this.#apiKey = options.apiKey;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.#baseUrl) return false;
    try {
      const response = await fetch(`${this.#baseUrl}/models`, {
        headers: this.#headers(),
        signal: AbortSignal.timeout(800),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate(messages: ModelMessage[]): Promise<string> {
    if (!this.#baseUrl) throw new Error(`${this.name} is not configured.`);
    const response = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.#headers() },
      body: JSON.stringify({ model: this.#model, messages, temperature: 0.2, max_tokens: 700 }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`${this.name} returned HTTP ${response.status}.`);
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${this.name} returned no text.`);
    return content;
  }

  #headers(): Record<string, string> {
    return this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {};
  }
}
