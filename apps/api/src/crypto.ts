/** Local credential vault: AES-256-GCM with a per-installation key file.
 * Raw secrets never enter workflow JSON, logs, or evidence (project.md §8.4). */
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";

export class Vault {
  private key: Buffer;

  constructor(dataDir: string) {
    const keyPath = join(dataDir, "vault.key");
    mkdirSync(dirname(keyPath), { recursive: true });
    if (existsSync(keyPath)) {
      this.key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "hex");
    } else {
      this.key = randomBytes(32);
      writeFileSync(keyPath, this.key.toString("hex"), { mode: 0o600 });
      try {
        chmodSync(keyPath, 0o600);
      } catch {
        /* best effort on non-POSIX */
      }
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
  }

  decrypt(blob: string): string {
    const [iv, tag, data] = blob.split(".");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  }
}
