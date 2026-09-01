import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createDecipheriv } from "node:crypto";
import { join } from "node:path";
import { once } from "node:events";
import { publicModule, hash } from "../../../../packages/pay/scripts/x402-boundary-runtime.mjs";
import { initializeStore, durableStore } from "./durable-store.mjs";

const [consumer, originalDirectory, condition, output] = process.argv.slice(2), inventory = [];
const { createPayClient } = await publicModule(consumer, "@0xkey-io/pay/client", condition, inventory);
const { Credential } = await publicModule(consumer, "mppx", condition, inventory);
const { privateKeyToAccount } = await publicModule(consumer, "viem/accounts", condition, inventory);
const emit = event => process.stdout.write(JSON.stringify(event) + "\n");
emit({ type: "versions", versions: { node: process.versions.node, pay: inventory[0].version, mppx: inventory[1].version } });
const [start] = await once(process.stdin, "data"); assert.deepEqual(JSON.parse(start), { type: "start" });
emit({ type: "ready", port: 0 });
const originalBytes = await readFile(join(originalDirectory, "realm-saved.aead"));
const key = await readFile(join(originalDirectory, "storage.key"));
const decipher = createDecipheriv("aes-256-gcm", key, originalBytes.subarray(0, 12));
decipher.setAAD(Buffer.from("pay-conformance-v1")); decipher.setAuthTag(originalBytes.subarray(12, 28));
const original = JSON.parse(Buffer.concat([decipher.update(originalBytes.subarray(28)), decipher.final()]));
const authorization = record => record.payment.headers.find(([name]) => name === "authorization");
const originalCredential = Credential.deserialize(authorization(original)[1]); assert.equal(originalCredential.challenge.realm, "billing");
const signer = privateKeyToAccount((await readFile(join(originalDirectory, "signer.key"), "utf8")).trim());
const source = { path: originalDirectory, ciphertextSha256: hash(originalBytes), keySha256: hash(key), recordDigest: original.digest, credentialSha256: hash(authorization(original)[1]) };
const cases = [
  ["challenge-realm", "PAYMENT_POLICY_DENIED", true, record => { const credential = Credential.deserialize(authorization(record)[1]); credential.challenge.realm = "changed-billing"; authorization(record)[1] = Credential.serialize(credential); }],
  ["challenge-id", "PAYMENT_POLICY_DENIED", true, record => { const credential = Credential.deserialize(authorization(record)[1]); credential.challenge.id += "-changed"; authorization(record)[1] = Credential.serialize(credential); }],
  ["authorization-nonce", "PAYMENT_POLICY_DENIED", true, record => { const credential = Credential.deserialize(authorization(record)[1]); credential.payload.nonce = "0x" + "11".repeat(32); authorization(record)[1] = Credential.serialize(credential); }],
  ["challenge-amount", "PAYMENT_POLICY_DENIED", true, record => { const credential = Credential.deserialize(authorization(record)[1]); credential.challenge.request.amount = "9999"; authorization(record)[1] = Credential.serialize(credential); }],
  ["authorization-payee", "PAYMENT_POLICY_DENIED", true, record => { const credential = Credential.deserialize(authorization(record)[1]); credential.payload.to = "0x2222222222222222222222222222222222222222"; authorization(record)[1] = Credential.serialize(credential); }],
  ["economic-effect-digest", "PENDING_PAYMENT_CORRUPT", true, record => { record.payment.economicEffectDigest = "0x" + "11".repeat(32); }],
  ["actual-forbidden-host", "PENDING_PAYMENT_CORRUPT", true, record => { record.payment.url = "https://forbidden.example/paid"; }],
  ["frozen-url", "PENDING_PAYMENT_CORRUPT", false, record => { record.payment.url += "?changed=1"; }],
  ["frozen-headers", "PENDING_PAYMENT_CORRUPT", false, record => { record.payment.headers.push(["x-changed", "true"]); }],
  ["frozen-body", "PENDING_PAYMENT_CORRUPT", false, record => { record.payment.bodyBase64 = Buffer.from("changed body").toString("base64"); }],
  ["frozen-method", "PENDING_PAYMENT_CORRUPT", false, record => { record.payment.method = "POST"; }],
  // The authenticated store owns decryption; its generic thrown error keeps
  // the existing public recovery service-unavailable envelope.
  ["aead-ciphertext-bitflip", "PAYMENT_SERVICE_UNAVAILABLE", false, () => {}],
];
const rows = [];
for (const [name, code, recomputed, mutate] of cases) {
  const directory = join(output, name); initializeStore(directory);
  const record = structuredClone(original); mutate(record);
  if (recomputed) { const { requestDigest, ...unsigned } = record.payment; record.payment.requestDigest = "0x" + hash(JSON.stringify(unsigned)); record.digest = record.payment.requestDigest; }
  const fixtureStore = durableStore(directory, () => {}, () => false); assert.equal(await fixtureStore.saveIfAbsent(record), true);
  assert.deepEqual(await fixtureStore.load(), record);
  const beforeBytes = await readFile(join(directory, "pending.aead"));
  await writeFile(join(directory, "authenticated-derived.aead"), beforeBytes, { flag: "wx", mode: 0o600 });
  if (name === "aead-ciphertext-bitflip") { const altered = Buffer.from(beforeBytes); altered[altered.length - 1] ^= 1; await writeFile(join(directory, "pending.aead"), altered); }
  const retainedBytes = await readFile(join(directory, "pending.aead"));
  const counters = { sign: 0, save: 0, signedSend: 0, clear: 0, verify: 0 };
  const client = createPayClient({ account: { address: signer.address, async signTypedData() { counters.sign++; throw new Error("SIGN_FORBIDDEN"); } }, network: "eip155:84532", policy: { allowHosts: [new URL(original.payment.url).host], maxAmount: "$0.01", preference: ["mpp"] }, recovery: { protection: "aead", load: fixtureStore.load, async saveIfAbsent() { counters.save++; throw new Error("SAVE_FORBIDDEN"); }, async clear() { counters.clear++; throw new Error("CLEAR_FORBIDDEN"); } }, verification: { async verifier() { counters.verify++; throw new Error("VERIFY_FORBIDDEN"); } }, async fetch() { counters.signedSend++; throw new Error("SEND_FORBIDDEN"); } });
  const errors = [];
  for (const operation of ["pending", "resume"]) {
    await assert.rejects(client[operation](), error => { errors.push({ operation, code: error.code, phase: error.phase, retryable: error.retryable }); return error.code === code && error.retryable === (name === "aead-ciphertext-bitflip"); });
  }
  assert.deepEqual(Object.values(counters), [0, 0, 0, 0, 0]);
  assert.deepEqual(await readFile(join(directory, "pending.aead")), retainedBytes);
  assert.deepEqual(await readFile(join(originalDirectory, "realm-saved.aead")), originalBytes);
  rows.push({ name, errors, counters, source, derived: { ciphertextSha256: hash(beforeBytes), retainedSha256: hash(retainedBytes), recordDigest: record.digest, credentialSha256: hash(authorization(record)[1]), aeadAuthenticated: name !== "aead-ciphertext-bitflip", checksumRecomputed: recomputed }, boundary: recomputed ? name === "actual-forbidden-host" ? "actual-url-host-policy" : name === "economic-effect-digest" ? "economic-binding" : "credential-challenge-authorization" : name === "aead-ciphertext-bitflip" ? "store-authentication" : "original-request-checksum", retained: true });
}
await writeFile(join(output, "observation.json"), JSON.stringify({ inventory, source, rows }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
emit({ type: "observation", counters: { sign: 0, save: 0, signedSend: 0, clear: 0 } }); emit({ type: "result", assertions: rows.length * 5 });
