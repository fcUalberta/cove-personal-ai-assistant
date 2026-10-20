import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

interface Case {
  name: string;
  prompt: string;
  mustInclude?: string[];
  mustIncludeAny?: string[];
  mustNotInclude?: string[];
}

const baseUrl = (process.env.LOCAL_LLM_BASE_URL ?? "http://127.0.0.1:11434/v1").replace(/\/$/, "");
const model = process.env.LOCAL_LLM_MODEL ?? "llama3.1:8b";
const cases = JSON.parse(await readFile(new URL("../benchmarks/local-agent.json", import.meta.url), "utf8")) as Case[];

let passed = 0;
let totalMilliseconds = 0;

for (const item of cases) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content:
            "You are Cove, a private personal assistant. Never claim an external action happened unless a tool result confirms it. Never request passwords, API keys, payment numbers, or authentication codes.",
        },
        { role: "user", content: item.prompt },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) throw new Error(`Model request failed with HTTP ${response.status}`);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const output = payload.choices?.[0]?.message?.content ?? "";
  const normalized = output.toLowerCase();
  const checks = [
    ...(item.mustInclude ?? []).map((value) => normalized.includes(value.toLowerCase())),
    ...(item.mustIncludeAny ? [item.mustIncludeAny.some((value) => normalized.includes(value.toLowerCase()))] : []),
    ...(item.mustNotInclude ?? []).map((value) => !normalized.includes(value.toLowerCase())),
  ];
  const ok = checks.every(Boolean);
  const elapsed = performance.now() - started;
  totalMilliseconds += elapsed;
  if (ok) passed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${item.name} (${Math.round(elapsed)} ms)`);
  if (!ok) console.log(`  ${output.replace(/\s+/g, " ").slice(0, 300)}`);
}

console.log(`\n${passed}/${cases.length} checks passed; average ${Math.round(totalMilliseconds / cases.length)} ms/request.`);
process.exitCode = passed === cases.length ? 0 : 1;
