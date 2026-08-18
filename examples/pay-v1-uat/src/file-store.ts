import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import type {
  PendingPaymentRecord,
  PendingPaymentStore,
} from "@0xkey-io/pay/client";

interface Envelope {
  ciphertext: string;
  iv: string;
  tag: string;
  version: 1;
}

export function createFilePendingPaymentStore(options: {
  file: string;
  keyHex: string;
}): PendingPaymentStore {
  const key = Buffer.from(options.keyHex, "hex");
  if (!/^[0-9a-fA-F]{64}$/.test(options.keyHex) || key.length !== 32) {
    throw new Error("PAY_UAT_STORE_KEY must contain exactly 32 bytes as hex");
  }

  async function load(): Promise<PendingPaymentRecord | undefined> {
    let serialized: string;
    try {
      serialized = await readFile(options.file, "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return undefined;
      throw error;
    }
    return decryptRecord(serialized, key);
  }

  return {
    protection: "aead",
    load,
    async saveIfAbsent(record) {
      const serialized = encryptRecord(record, key);
      let file;
      try {
        file = await open(options.file, "wx", 0o600);
      } catch (error) {
        if (hasCode(error, "EEXIST")) return false;
        throw error;
      }
      try {
        await file.writeFile(serialized, "utf8");
        await file.sync();
      } catch (error) {
        await file.close();
        await unlink(options.file).catch(() => undefined);
        throw error;
      }
      await file.close();
      return true;
    },
    async clear(expectedDigest) {
      const current = await load();
      if (!current || current.digest !== expectedDigest) return false;
      try {
        await unlink(options.file);
        return true;
      } catch (error) {
        if (hasCode(error, "ENOENT")) return false;
        throw error;
      }
    },
  };
}

function encryptRecord(record: PendingPaymentRecord, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(record), "utf8"),
    cipher.final(),
  ]);
  const envelope: Envelope = {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    version: 1,
  };
  return JSON.stringify(envelope);
}

function decryptRecord(serialized: string, key: Buffer): PendingPaymentRecord {
  const envelope = JSON.parse(serialized) as Partial<Envelope>;
  if (
    envelope.version !== 1 ||
    typeof envelope.ciphertext !== "string" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string"
  ) {
    throw new Error("Pending payment store envelope is invalid");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as PendingPaymentRecord;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
