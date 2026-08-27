import assert from "node:assert/strict";
import test from "node:test";
import { redactOutput, validateEvent } from "../src/redact.mjs";

const validEvents = [
  { type: "versions", versions: { node: "24.3.0" } },
  { type: "ready", port: 1234 },
  { type: "observation", counters: { sign: 1 } },
  { type: "result", assertions: 1 },
];

for (const event of validEvents) {
  test(`${event.type} accepts its primitive kind but rejects coercible discriminators before dispatch`, () => {
    assert.deepEqual(validateEvent(event), event);
    assert.deepEqual(redactOutput(JSON.stringify(event)).events, [event]);
    let coercions = 0;
    for (const type of [
      [event.type],
      [[event.type]],
      new String(event.type),
      {
        toString() {
          coercions++;
          return event.type;
        },
      },
      {
        [Symbol.toPrimitive]() {
          coercions++;
          return event.type;
        },
      },
      null,
      undefined,
      true,
      1,
    ]) {
      assert.throws(() => validateEvent({ ...event, type }), {
        message: "CONTROL_EVENT_REJECTED",
      });
    }
    assert.equal(coercions, 0);
    const sentinel = "synthetic-discriminator-secret-7a";
    const field = Object.keys(event).find((key) => key !== "type");
    for (const type of [[event.type], [[event.type]], { value: event.type }]) {
      const result = redactOutput(
        JSON.stringify({
          type,
          [field]: { credential: sentinel },
        }),
      );
      assert.equal(JSON.stringify(result).includes(sentinel), false);
      assert.deepEqual(result.events, []);
      assert.equal(result.discardedLines, 1);
    }
  });
}

test("prototype property names and unknown strings are not event kinds", () => {
  for (const type of [
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "",
    "unknown",
  ]) {
    assert.throws(() => validateEvent({ type }), {
      message: "CONTROL_EVENT_REJECTED",
    });
    assert.deepEqual(redactOutput(JSON.stringify({ type })).events, []);
  }
});

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
