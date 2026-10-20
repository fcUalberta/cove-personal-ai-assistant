import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EncryptedJsonStore } from "../src/storage/encryptedStore.ts";

test("encrypted store round-trips without plaintext at rest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cove-store-"));
  const file = join(directory, "data.enc.json");
  const key = join(directory, "key");
  const store = new EncryptedJsonStore<{ secret: string }>(file, key);
  await store.write({ secret: "meet Sarah at eleven" });
  assert.deepEqual(await store.read({ secret: "" }), { secret: "meet Sarah at eleven" });
  const encoded = await readFile(file, "utf8");
  assert.equal(encoded.includes("meet Sarah"), false);
});
