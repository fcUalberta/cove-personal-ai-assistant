import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { dirname } from "node:path";

interface Envelope {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class EncryptedJsonStore<T> {
  readonly #filePath: string;
  readonly #keyPath: string;
  #key?: Buffer;

  constructor(filePath: string, keyPath: string) {
    this.#filePath = filePath;
    this.#keyPath = keyPath;
  }

  async read(fallback: T): Promise<T> {
    try {
      const encoded = await readFile(this.#filePath, "utf8");
      const envelope = JSON.parse(encoded) as Envelope;
      const key = await this.#getKey();
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString("utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    const key = await this.#getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify(value, null, 2));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: Envelope = {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    await writeFile(this.#filePath, JSON.stringify(envelope), { mode: 0o600 });
  }

  async #getKey(): Promise<Buffer> {
    if (this.#key) return this.#key;

    // Keep the original salt and legacy variable fallback so early prototype
    // data remains decryptable after the product rename from Muse to Cove.
    const configured = process.env.COVE_LOCAL_KEY ?? process.env.MUSE_LOCAL_KEY;
    if (configured) {
      this.#key = scryptSync(configured, "muse-private-agent-v1", 32);
      return this.#key;
    }

    await mkdir(dirname(this.#keyPath), { recursive: true });
    try {
      this.#key = Buffer.from(await readFile(this.#keyPath, "utf8"), "base64");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#key = randomBytes(32);
      await writeFile(this.#keyPath, this.#key.toString("base64"), { mode: 0o600 });
      await chmod(this.#keyPath, 0o600);
    }
    return this.#key;
  }
}
