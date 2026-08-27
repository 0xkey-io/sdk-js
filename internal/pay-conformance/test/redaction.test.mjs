import assert from "node:assert/strict";
import test from "node:test";
import { redactOutput, validateEvent } from "../src/redact.mjs";

test("raw stderr, errors, credentials and receipts are never copied into evidence", () => {
  const sentinel = "unique-private-sentinel-7a";
  const inputs = [
    sentinel,
    JSON.stringify({ type: "ready", port: 1234, cause: sentinel }),
    JSON.stringify({ type: "observation", receipt: { transaction: sentinel } }),
    "Authorization: Payment " + sentinel,
    "X-Stamp: " + sentinel,
  ];
  for (const input of inputs) {
    const result = redactOutput(input);
    assert.equal(JSON.stringify(result).includes(sentinel), false);
    assert.equal(result.discardedLines, 1);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
  }
});

test("bounded control facts survive but unknown fields and bad counter types fail closed", () => {
  const event = {
    type: "observation",
    counters: { sign: 1, settle: 0 },
    digests: { credentialSha256: "a".repeat(64) },
  };
  assert.deepEqual(validateEvent(event), event);
  for (const value of [
    { ...event, body: "secret" },
    { type: "observation", counters: { sign: -1 } },
    { type: "observation", counters: { secret: 1 } },
    { type: "versions", versions: { mppx: "secret" } },
  ]) {
    assert.throws(() => validateEvent(value), {
      message: "CONTROL_EVENT_REJECTED",
    });
  }
  assert.deepEqual(redactOutput(JSON.stringify(event) + "\n").events, [event]);
});
