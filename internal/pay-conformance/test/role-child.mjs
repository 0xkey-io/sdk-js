import net from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { counters } from "../fixtures/runtime/common.mjs";

await once(process, "message");
const server = net.createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
const scenario = process.argv[2], digest = "1".repeat(64);
if (scenario === "timeout") {
  const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env: process.env, stdio: "ignore" });
  await once(descendant, "spawn");
}
process.send({ type: "ready", port: server.address().port });
await once(process, "message");
if (scenario === "timeout") await new Promise(() => {});
process.send({ type: "completed", counters: counters(), events: [], status: 200, credentialSha256: digest, receiptSha256: digest, receiptValid: true });
if (scenario === "corrupt") process.send({ type: ["snapshot"], counters: { credential: "SYNTHETIC_ROLE_SECRET" } });
else if (scenario === "overflow") process.stdout.write("SYNTHETIC_ROLE_SECRET".repeat(7000));
else if (scenario === "queue") for (let n = 0; n < 12; n++) process.send({ type: "ready", port: 1 });
else if (scenario === "stderr") process.stderr.write("SYNTHETIC_ROLE_SECRET");
else if (scenario.startsWith("warning-")) {
  const warning = "Failed to fetch supported kinds from facilitator: PayError: PAYMENT_SERVICE_UNAVAILABLE: payment service is unavailable\n";
  process.stderr.write(scenario === "warning-altered" ? warning.replace("unavailable", "unavailablE") : scenario === "warning-duplicate" ? warning.repeat(2) : scenario === "warning-appended-secret" ? warning + "SYNTHETIC_ROLE_SECRET" : warning);
  if (scenario === "warning-stdout") process.stdout.write("SYNTHETIC_ROLE_SECRET");
}
else if (scenario !== "success") throw new Error("UNKNOWN_TEST_SCENARIO");
await new Promise(resolve => server.close(resolve));
process.disconnect();
