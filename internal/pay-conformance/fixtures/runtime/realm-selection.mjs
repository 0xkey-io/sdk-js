import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeScenario } from "./scenario.mjs";
import { initializeStore, durableStore } from "./durable-store.mjs";
import { publicModule, certificates, tlsFetch, hash } from "./common.mjs";
const [inputPath, condition, output] = process.argv.slice(2), input = JSON.parse(await readFile(inputPath)), inventory = [];
const { createPayClient } = await publicModule(input.consumer.directory, "@0xkey-io/pay/client", condition, inventory);
const wire = await publicModule(input.native, "@x402/core/http", condition, inventory);
const emit = event => process.stdout.write(JSON.stringify(event) + "\n");
emit({ type: "versions", versions: { node: process.versions.node, pay: inventory[0].version, x402: inventory[1].version } });
const [start] = await once(process.stdin, "data"); assert.deepEqual(JSON.parse(start), { type: "start" });
globalThis.fetch = async () => { throw new Error("UNCONFIGURED_TRANSPORT"); };
const scenario = nativeScenario({ config: { condition, protocol: "x402", payBuyer: true, native: input.native, pay: input.consumer.directory, certificates: input.certificates }, assert });
const counters = { sign: 0, save: 0, signedSend: 0, clear: 0, verify: 0, unsignedSend: 0 };
let error, forbiddenHost, offer, snapshots;
try {
  const facilitator = await scenario.spawnRole("scripted-facilitator"), merchant = await scenario.spawnRole("merchant", { facilitator: facilitator.origin });
  emit({ type: "ready", port: Number(new URL(merchant.origin).port) });
  await scenario.verifyTls([facilitator, merchant]);
  const tls = await certificates(input.certificates), transport = tlsFetch(tls.ca, new Set([merchant.origin]));
  const directory = join(output, "durable"); initializeStore(directory); const store = durableStore(directory, () => {}, () => false);
  const client = createPayClient({ account: { address: "0x1111111111111111111111111111111111111111", async signTypedData() { counters.sign++; throw new Error("SIGN_FORBIDDEN"); } }, network: "eip155:84532", policy: { allowHosts: [new URL(merchant.origin).host], maxAmount: "$0.01", preference: ["mpp"] }, recovery: { protection: "aead", load: store.load, async saveIfAbsent() { counters.save++; throw new Error("SAVE_FORBIDDEN"); }, async clear() { counters.clear++; throw new Error("CLEAR_FORBIDDEN"); } }, verification: { async verifier() { counters.verify++; throw new Error("VERIFY_FORBIDDEN"); } }, async fetch(input, init) { const request = new Request(input, init); if (request.headers.has("authorization") || request.headers.has("payment-signature")) counters.signedSend++; else counters.unsignedSend++; const response = await transport(request); const header = response.headers.get("payment-required"); assert.equal(response.status, 402); assert.equal(response.headers.has("www-authenticate"), false); const decoded = wire.decodePaymentRequiredHeader(header); assert.equal(decoded.x402Version, 2); assert.equal(decoded.accepts[0].scheme, "exact"); offer = { headerSha256: hash(header), decodedSha256: hash(JSON.stringify(decoded)), nativeOwner: inventory[1] }; return response; } });
  await assert.rejects(client.fetch("https://forbidden.example/paid"), value => { forbiddenHost = { code: value.code, phase: value.phase, retryable: value.retryable }; return value.code === "PAY_HOST_DENIED" && value.phase === "policy" && !value.retryable; });
  assert.deepEqual(Object.values(counters), [0, 0, 0, 0, 0, 0]);
  await assert.rejects(client.fetch(merchant.origin + "/paid"), value => { error = { code: value.code, phase: value.phase, retryable: value.retryable }; return value.code === "PAYMENT_OFFER_UNSUPPORTED" && value.phase === "challenge" && !value.retryable; });
  assert.equal(await client.pending(), undefined); assert.equal(await store.load(), undefined);
  assert.deepEqual(Object.values(counters), [0, 0, 0, 0, 0, 1]);
  snapshots = [];
  for (const role of [merchant, facilitator]) { role.send({ type: "snapshot" }); const snapshot = await role.take("snapshot"); assert.deepEqual(snapshot.failures, []); for (const name of ["settle", "handler", "economicEffect", "applicationEffect", "rpc"]) assert.equal(snapshot.counters[name], 0); snapshots.push(snapshot); }
  assert.deepEqual(snapshots[0].received, []); assert.equal(snapshots[0].counters.challenge, 1);
  await scenario.closeRoles([merchant, facilitator]);
} finally {
  const diagnostics = await scenario.cleanup();
  await writeFile(join(output, "observation.json"), JSON.stringify({ scope: "real-x402-only-mpp-preference", coverage: "partial", aggregateStatus: "BLOCKED", condition, inventory, error, forbiddenHost, offer, counters, snapshots, roles: scenario.roles.map(role => role.identity), ports: scenario.ports, tls: scenario.tlsControls, diagnostics }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
}
emit({ type: "observation", counters: { sign: 0, save: 0, signedSend: 0, clear: 0 } }); emit({ type: "result", assertions: 12 });
