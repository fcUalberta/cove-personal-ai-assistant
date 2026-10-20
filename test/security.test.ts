import test from "node:test";
import assert from "node:assert/strict";
import { minimizeForCloud, redactSensitiveText } from "../src/security/redact.ts";

test("redacts common direct identifiers and secrets", () => {
  const result = redactSensitiveText(
    "Email alex@example.com or call +1 (416) 555-0199. token-secret_abcdefghijklmnop",
  );
  assert.equal(result.text.includes("alex@example.com"), false);
  assert.equal(result.text.includes("416"), false);
  assert.equal(result.text.includes("abcdefghijklmnop"), false);
  assert.deepEqual(new Set(result.redactions), new Set(["EMAIL", "PHONE", "SECRET"]));
});

test("cloud minimization limits memories and request length", () => {
  const result = minimizeForCloud("x".repeat(8_000), Array.from({ length: 10 }, (_, i) => `preference ${i}`));
  assert.ok(result.text.length < 5_000);
  assert.equal(result.text.includes("preference 4"), true);
  assert.equal(result.text.includes("preference 5"), false);
});
