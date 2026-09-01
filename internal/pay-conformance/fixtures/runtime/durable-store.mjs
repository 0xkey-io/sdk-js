import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, rmdirSync, openSync, closeSync, fsyncSync, writeFileSync, linkSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// Test-owned implementation of the public authenticated-store contract. The
// key survives child exits outside the encrypted record. Never used in Pay.
export function initializeStore(directory) {
  mkdirSync(directory, { mode: 0o700 });
  const fd = openSync(join(directory, "storage.key"), "wx", 0o600);
  try { writeFileSync(fd, randomBytes(32)); fsyncSync(fd); } finally { closeSync(fd); }
  const signer = openSync(join(directory, "signer.key"), "wx", 0o600);
  try { writeFileSync(signer, "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"); fsyncSync(signer); } finally { closeSync(signer); }
  sync(directory);
}
function sync(directory) { const fd = openSync(directory, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
export function durableStore(directory, observe, permitClear) {
  const key = readFileSync(join(directory, "storage.key")); assert.equal(key.length, 32);
  const path = join(directory, "pending.aead"), lock = join(directory, "claim"), aad = Buffer.from("pay-conformance-v1");
  const locked = operation => { mkdirSync(lock, { mode: 0o700 }); try { return operation(); } finally { rmdirSync(lock); } };
  const read = () => {
    if (!existsSync(path)) return undefined;
    const bytes = readFileSync(path); assert.ok(bytes.length > 28 && bytes.length <= 131072);
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    cipher.setAAD(aad); cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]));
  };
  return {
    protection: "aead",
    async load() { return locked(read); },
    async saveIfAbsent(record) { return locked(() => {
      if (existsSync(path)) return false;
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(aad);
      const plaintext = Buffer.from(JSON.stringify(record)); assert.ok(plaintext.length <= 131044);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const draft = join(directory, `draft-${process.pid}-${randomBytes(8).toString("hex")}`), fd = openSync(draft, "wx", 0o600);
      try { writeFileSync(fd, Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])); fsyncSync(fd); } finally { closeSync(fd); }
      linkSync(draft, path); unlinkSync(draft); sync(directory);
      assert.equal(read().digest, record.digest); observe("save", record.digest); return true;
    }); },
    async clear(expectedDigest) { return locked(() => {
      const record = read(); if (!record || record.digest !== expectedDigest) return false;
      assert.equal(permitClear(), true, "CLEAR_BEFORE_ECONOMIC_PROOF");
      unlinkSync(path); sync(directory); observe("clear", expectedDigest); return true;
    }); },
  };
}
