import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { boot, certificates, send, receive, counters, tlsFetch, hash, network, organizationId } from "./common.mjs";

try {
  const { config, modules } = await boot(async (config, load) => ({ pay: await load(config.pay, "@0xkey-io/pay/x402"), errors: await load(config.pay, "@0xkey-io/pay/client"), native: await load(config.native, "@x402/core/server") }));
  assert.equal(config.protocol, "x402"); assert.ok(config.supportCaseId.startsWith("X-"));
  const tls = await certificates(config.certificates), transport = tlsFetch(tls.ca, new Set([config.facilitator]));
  const supportTransports = [], count = counters(); let calls = 0;
  const fetch = async (input, init) => {
    assert.equal(input, config.facilitator + "/supported"); assert.equal(init.method, "GET");
    const startedAtNs = process.hrtime.bigint().toString(); let response, transportError = null;
    try { response = await transport(input, init); return response; }
    catch (error) { transportError = error.code; throw error; }
    finally { supportTransports.push({ startedAtNs, completedAtNs: process.hrtime.bigint().toString(), responseStatus: response?.status ?? null, transportError }); }
  };
  const ec = createECDH("prime256v1"); ec.generateKeys();
  const client = modules.pay.create0xkeyFacilitatorClient({ network, organizationId, facilitatorUrl: config.facilitator, fetch, facilitatorResponseError: modules.native.FacilitatorResponseError, apiKey: { publicKey: ec.getPublicKey("hex", "compressed"), privateKey: ec.getPrivateKey("hex").padStart(64, "0") } });
  send({ type: "ready", port: 0 });
  for (const stage of ["negative", "positive"]) {
    assert.deepEqual(await receive(), { type: "support-call", caseId: config.supportCaseId, stage });
    let result = null, error = null; calls++;
    try { result = await client.getSupported(); }
    catch (caught) {
      assert.equal(stage, "negative");
      const cause = caught.cause, descriptor = Object.getOwnPropertyDescriptor(caught, "cause");
      assert.ok(caught instanceof modules.native.FacilitatorResponseError); assert.ok(cause instanceof modules.errors.PayError);
      assert.equal(descriptor.value, cause); assert.equal(descriptor.get, undefined); assert.equal(descriptor.set, undefined);
      assert.deepEqual([descriptor.enumerable, descriptor.writable, descriptor.configurable], [false, false, false]);
      assert.deepEqual([cause.code, cause.phase, cause.retryable], ["PAYMENT_SERVICE_UNAVAILABLE", "request", true]);
      error = { nativeInstance: true, causeInstance: true, causeIdentity: descriptor.value === cause, causeDescriptor: { enumerable: descriptor.enumerable, writable: descriptor.writable, configurable: descriptor.configurable }, code: cause.code, phase: cause.phase, retryable: cause.retryable, errorSha256: hash(String(caught)), causeSha256: hash(String(cause)) };
    }
    if (stage === "positive") assert.deepEqual(result, { kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} });
    else assert.ok(error);
    send({ type: "support-caller-result", caseId: config.supportCaseId, stage, calls, counters: count, events: [], error, result, supportTransports });
  }
  process.disconnect();
} catch (error) {
  send({ type: "failure", messageSha256: hash(String(error?.message)) }); process.exitCode = 1;
  if (process.connected) process.disconnect();
}
