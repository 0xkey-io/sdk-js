// The private harness keeps its existing strict binding admission; release
// tooling supports ordinary platform paths without importing this harness.
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { materializeConsumer as materialize, verifyConsumer as verify } from "../../../packages/pay/scripts/fixed-consumer.mjs";
const repository = fileURLToPath(new URL("../../../", import.meta.url)).replace(/[\\/]$/, "");
function binding(value) {
  const canonical = path => typeof path === "string" && /^\/[A-Za-z0-9._/-]+$/.test(path) && resolve(path) === path;
  if (!value || !canonical(value.directory) || !canonical(value.artifact) || value.directory === repository || value.directory.startsWith(repository + sep)) throw new Error("CONSUMER_BINDING_REJECTED");
  return value;
}
export async function materializeConsumer(value) { return materialize(binding(value)); }
export async function verifyConsumer(value, installed = false) { return verify(binding(value), installed); }
