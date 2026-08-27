import { readFileSync, writeFileSync, existsSync, mkdirSync, rmdirSync, openSync, closeSync, fsyncSync, linkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { publicModule, tlsFetch, hash, check, network } from "./x402-boundary-runtime.mjs";
const [payApp, tlsDir, directory, merchant, backend, stage] = process.argv.slice(2);
const emit = (type, fields = {}) => console.log(JSON.stringify({ type, stage, atNs: process.hrtime.bigint().toString(), ...fields }));
const secretKey = readFileSync(join(directory, "storage.key"));
const signerKey = readFileSync(join(directory, "signer.key"), "utf8");
const ca = readFileSync(join(tlsDir, "loopback-ca-v2.pem"));
const file = join(directory, "pending.aead"), lock = join(directory, "claim");
const locked = fn => { mkdirSync(lock, { mode: 0o700 }); try { return fn(); } finally { rmdirSync(lock); } };
const sync = () => { const fd = openSync(directory, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } };
const load = () => {
  if (!existsSync(file)) return undefined;
  const bytes = readFileSync(file); check(bytes.length <= 65536, "record-bound");
  const decipher = createDecipheriv("aes-256-gcm", secretKey, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from("x402-boundary-recovery-v1")); decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
};
let rpcCalls = 0, signedSends = 0;
const fetch = tlsFetch(ca, new Set([merchant, backend]));
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (request.headers.has("payment-signature")) {
    const record = load(); check(!!record, "pending-before-send"); signedSends++;
    emit("signed-send", { credentialSha256: hash(request.headers.get("payment-signature")), recordDigest: record.digest });
  }
  if (request.url === backend + "/rpc") { rpcCalls++; emit("rpc-request"); }
  const response = await fetch(request);
  if (request.url === merchant + "/paid") {
    emit("merchant-response", { status: response.status, hasChallenge: response.headers.has("PAYMENT-REQUIRED"), hasReceipt: response.headers.has("PAYMENT-RESPONSE") });
  }
  return response;
};
const recovery = {
  protection: "aead",
  async load() { const record = locked(load); emit("load", { present: !!record }); return record; },
  async saveIfAbsent(record) { return locked(() => {
    if (existsSync(file)) return false;
    check(record.payment.network === network && record.payment.protocolId === "x402-exact-v2-eip3009", "stored-profile");
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secretKey, nonce);
    cipher.setAAD(Buffer.from("x402-boundary-recovery-v1"));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()]);
    const draft = join(directory, "record-draft");
    const fd = openSync(draft, "wx", 0o600);
    try { writeFileSync(fd, Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])); fsyncSync(fd); } finally { closeSync(fd); }
    linkSync(draft, file); unlinkSync(draft); sync();
    check(load().digest === record.digest, "authenticated-roundtrip"); emit("save", { recordDigest: record.digest }); return true;
  }); },
  async clear(expected) { return locked(() => {
    const record = load(); if (!record || record.digest !== expected) return false;
    check(stage === "proof" && rpcCalls === 4, "clear-after-full-proof");
    unlinkSync(file); sync(); emit("clear", { matchingDigest: true, rpcCalls }); return true;
  }); },
};
const inventory = [];
const { privateKeyToAccount } = await publicModule(payApp, "viem/accounts", "require", inventory);
const signer = privateKeyToAccount(signerKey);
let signs = 0;
const account = { address: signer.address, async signTypedData(input) {
  check(stage === "unknown" && signs === 0, "no-resign");
  const signature = await signer.signTypedData(input); signs++; emit("cryptographic-signature", { count: signs }); return signature;
} };
const { createPayClient } = await publicModule(payApp, "@0xkey-io/pay/client", "require", inventory);
emit("buyer-inventory", { inventory });
const client = createPayClient({ account, network, recovery, policy: { allowHosts: [new URL(merchant).host], maxAmount: "$0.01", preference: ["x402"] }, verification: { rpcUrl: backend + "/rpc" }, fetch: globalThis.fetch });
try {
  if (stage !== "unknown") {
    const pending = await client.pending(); check(pending?.protocolId === "x402-exact-v2-eip3009" && pending.network === network, "restart-profile");
  }
  const response = stage === "unknown" ? await client.fetch(merchant + "/paid") : await client.resume();
  check(stage === "proof" && response.status === 200, "unexpected-buyer-success");
  check(await client.pending() === undefined && !existsSync(file), "proof-cleared");
  emit("buyer-success", { signs, signedSends, rpcCalls });
} catch (error) {
  check(stage !== "proof", "proof-failed");
  // A syntactically undecodable receipt reaches the existing generic client
  // boundary; an economically mismatched decoded receipt has a different code.
  const expected = { unknown: "PAYMENT_STATUS_UNKNOWN", malformed: "PAYMENT_SERVICE_UNAVAILABLE", mismatch: "PAYMENT_RECEIPT_MISMATCH", rpc: "PAYMENT_RECEIPT_UNVERIFIED" }[stage];
  check(error.code === expected, "unexpected-buyer-error-" + String(error.code));
  check(existsSync(file) && !!(await client.pending()), "pending-must-remain");
  emit("buyer-unresolved", { code: error.code, signs, signedSends, rpcCalls });
}
