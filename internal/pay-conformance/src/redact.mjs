import { createHash } from "node:crypto";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const digestPattern = /^(?!0{64}$)[a-f0-9]{64}$/;
const counters = new Set([
  "sign",
  "save",
  "signedSend",
  "verify",
  "settle",
  "economicEffect",
  "handler",
  "applicationEffect",
  "fulfillment",
  "rpc",
  "clear",
  "challenge",
]);
const digests = new Set([
  "credentialSha256",
  "receiptSha256",
  "recordSha256",
  "requestSha256",
]);
const packageName = /^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/;
const version = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/;
const object = (value) =>
  !!value && Object.getPrototypeOf(value) === Object.prototype;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

export function validateEvent(event) {
  const reject = () => {
    throw new Error("CONTROL_EVENT_REJECTED");
  };
  if (!object(event) || typeof event.type !== "string") reject();
  const fieldsByType = {
    versions: ["type", "versions"],
    ready: ["type", "port"],
    observation: ["type", "counters", "digests"],
    result: ["type", "assertions"],
  };
  if (!Object.hasOwn(fieldsByType, event.type)) reject();
  const fields = fieldsByType[event.type];
  if (Object.keys(event).some((key) => !fields.includes(key))) reject();
  if (
    event.type === "versions" &&
    (!object(event.versions) ||
      !Object.keys(event.versions).length ||
      Object.entries(event.versions).some(
        ([key, value]) =>
          !packageName.test(key) ||
          typeof value !== "string" ||
          !version.test(value),
      ))
  )
    reject();
  if (event.type === "ready" && (!integer(event.port) || event.port > 65535))
    reject();
  if (
    event.type === "result" &&
    (!integer(event.assertions) || !event.assertions)
  )
    reject();
  if (event.type === "observation") {
    if (
      !object(event.counters) ||
      Object.entries(event.counters).some(
        ([key, value]) => !counters.has(key) || !integer(value),
      )
    )
      reject();
    if (
      event.digests !== undefined &&
      (!object(event.digests) ||
        Object.entries(event.digests).some(
          ([key, value]) =>
            !digests.has(key) ||
            typeof value !== "string" ||
            !digestPattern.test(value),
        ))
    )
      reject();
  }
  return structuredClone(event);
}

// Never regex-replace raw diagnostics: unknown text is represented only by its
// hash/length. The caller must not persist the raw input alongside this result.
export function redactOutput(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const events = [];
  let discardedLines = 0;
  for (const line of bytes.toString("utf8").split("\n")) {
    if (!line) continue;
    try {
      events.push(validateEvent(JSON.parse(line)));
    } catch {
      discardedLines++;
    }
  }
  return { events, discardedLines, bytes: bytes.length, sha256: sha256(bytes) };
}
