import test from "node:test";
import assert from "node:assert/strict";
import { buildMimeMessage } from "../src/integrations/google.ts";

test("Gmail draft MIME is URL-safe and blocks header injection", () => {
  const encoded = buildMimeMessage({
    to: "person@example.com\r\nBcc: attacker@example.com",
    subject: "Hello\nX-Injected: yes",
    body: "A private draft.",
  });
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  assert.match(decoded, /^To: person@example\.com Bcc: attacker@example\.com\r\n/);
  assert.match(decoded, /Subject: Hello X-Injected: yes/);
  assert.doesNotMatch(decoded, /\r\nBcc:/);
  assert.doesNotMatch(decoded, /\r\nX-Injected:/);
});
