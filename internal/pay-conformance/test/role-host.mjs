import { once } from "node:events";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { roleProcess } from "../src/role.mjs";

const emit = value => process.stdout.write(JSON.stringify(value) + "\n");
emit({ type: "versions", versions: { node: process.versions.node } });
const started = once(process.stdin, "end"); process.stdin.resume(); await started;
const config = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs" };
const scenario = process.argv[2], supported = scenario.startsWith("warning-");
if (supported && scenario !== "warning-ordinary") Object.assign(config, { payBuyer: false, supportCaseId: scenario === "warning-json" ? "S-supported-invalid-json" : scenario === "warning-shape" ? "S-supported-invalid-shape" : "S-supported-timeout", supportStage: scenario === "warning-positive" ? "positive" : "negative" });
if (scenario === "warning-mpp-only") Object.assign(config, { protocol: "mpp", supportCaseId: "S-mpp-only-nondependency-positive", supportStage: "positive" });
if (["warning-caller", "warning-x-merchant"].includes(scenario)) config.supportCaseId = "X-supported-timeout";
const roleName = !supported || scenario === "warning-buyer" ? "buyer" : scenario === "warning-facilitator" ? "scripted-facilitator" : scenario === "warning-caller" ? "supported-caller" : "merchant";
const role = roleProcess({ role: roleName, command: [process.execPath, join(import.meta.dirname, "role-child.mjs"), scenario], config, env: process.env });
try {
  const ready = await role.take("ready"); emit(ready);
  role.send({ type: "start" });
  const result = await role.close;
  let accepted = false, rejection = null;
  try { await role.take("completed"); accepted = true; }
  catch (error) { rejection = error.message === result.reason ? result.reason : "UNEXPECTED_REJECTION"; }
  const diagnostics = Object.fromEntries(Object.entries(role.streams).map(([name, chunks]) => { const bytes = Buffer.concat(chunks); return [name, { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }]; }));
  await writeFile(process.argv[3], JSON.stringify({ result, diagnostics, accepted, rejection, expectedSupportedWarning: role.expectedSupportedWarning ?? 0 }) + "\n", { flag: "wx", mode: 0o600 });
  emit({ type: "observation", counters: { sign: 0 } });
  emit({ type: "result", assertions: 1 });
} finally { await role.stop(); }
