import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { validateRoleMessage } from "./ipc.mjs";

export function roleProcess({ role, command, config, env }) {
  const child = spawn(command[0], command.slice(1), { env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const queue = [], waiters = [], streams = { stdout: [], stderr: [] }, failures = []; let length = 0, closed = false, closeCode, reason = null;
  const supportedWarning = Buffer.from("Failed to fetch supported kinds from facilitator: PayError: PAYMENT_SERVICE_UNAVAILABLE: payment service is unavailable\n");
  const expectedSupportedWarning = () => Number(role === "merchant" && config.payBuyer === false && config.supportStage === "negative" && ["S-supported-timeout", "S-supported-invalid-json", "S-supported-invalid-shape"].includes(config.supportCaseId) && Buffer.concat(streams.stderr).equals(supportedWarning));
  const reject = code => { reason ??= code; queue.length = 0; while (waiters.length) waiters.shift()({ type: "rejected" }); child.kill("SIGKILL"); };
  const close = new Promise(resolve => child.once("close", (code, signal) => {
    closed = true; closeCode = code;
    if (streams.stderr.length && !expectedSupportedWarning()) reason ??= "ROLE_STDERR_PRESENT";
    if (streams.stdout.length) reason ??= "ROLE_STDOUT_PRESENT";
    if (code !== 0) reason ??= "ROLE_EXIT_NONZERO";
    while (waiters.length) waiters.shift()({ type: "exited", code, signal });
    resolve({ code, signal, reason });
  }));
  for (const name of ["stdout", "stderr"]) child[name].on("data", chunk => {
    length += chunk.length;
    if (length > 131072) reject("ROLE_OUTPUT_LIMIT"); else streams[name].push(chunk);
  });
  child.on("message", message => {
    if (reason) return;
    try { message = validateRoleMessage(message); }
    catch { reject("IPC_MESSAGE_REJECTED"); return; }
    if (message.type === "failure") failures.push(message);
    if (waiters.length) waiters.shift()(message); else queue.push(message);
    if (queue.length > 10) reject("ROLE_QUEUE_LIMIT");
  });
  child.on("error", () => reject("ROLE_PROCESS_ERROR"));
  const next = () => queue.length ? Promise.resolve(queue.shift()) : closed ? Promise.resolve({ type: "exited", code: closeCode }) : new Promise(resolve => waiters.push(resolve));
  const take = async type => { if (reason) throw new Error(reason); const value = await next(); if (reason) throw new Error(reason); assert.equal(value.type, type, `ROLE_${role}_${type}`); return value; };
  const send = value => { if (reason) throw new Error(reason); child.send(validateRoleMessage(value), error => { if (error) reject("ROLE_CHANNEL_ERROR"); }); };
  send({ type: "identify", config });
  return { child, role, close, take, send, streams, failures,
    get expectedSupportedWarning() { return expectedSupportedWarning(); },
    async stop() { if (!closed) { child.kill("SIGKILL"); await close; } },
  };
}
