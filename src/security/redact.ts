const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)(?:\+?\d[\d .()-]{7,}\d)(?!\d)/g;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const API_KEY = /\b(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{12,}\b/gi;

export interface RedactionResult {
  text: string;
  redactions: string[];
}

export function redactSensitiveText(input: string): RedactionResult {
  const redactions: string[] = [];
  let text = input;

  const replace = (pattern: RegExp, label: string) => {
    text = text.replace(pattern, () => {
      redactions.push(label);
      return `[${label}]`;
    });
  };

  replace(EMAIL, "EMAIL");
  replace(PHONE, "PHONE");
  replace(CARD, "PAYMENT_NUMBER");
  replace(API_KEY, "SECRET");

  return { text, redactions };
}

export function minimizeForCloud(input: string, memories: string[]): RedactionResult {
  const selectedMemories = memories
    .filter((memory) => memory.length <= 300)
    .slice(0, 5)
    .map((memory) => `- ${memory}`)
    .join("\n");

  return redactSensitiveText(
    `User request:\n${input.slice(0, 4_000)}\n\nRelevant confirmed preferences only:\n${selectedMemories || "None"}`,
  );
}
