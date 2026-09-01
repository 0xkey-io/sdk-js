import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import net from "node:net";
import { roleProcess } from "../../src/role.mjs";
import { certificates, tlsFetch, hash } from "./common.mjs";

// One lifecycle per isolated subcase. Roles inherit the driver's supervised
// process group; this module adds neither a detached group nor a deadline.
export function nativeScenario({ config, assert }) {
  const roles = [], ports = [], tlsControls = [];

  async function spawnRole(role, extra = {}) {
    const processRole = roleProcess({ role, command: [process.execPath, join(import.meta.dirname, role + ".mjs")], config: { ...config, ...extra }, env: process.env }); roles.push(processRole);
    const identity = await processRole.take("identified");
    assert.equal(identity.pid, processRole.child.pid); assert.ok(identity.inventory.length > 0);
    for (const entry of identity.inventory) {
      assert.ok(["import", "require"].includes(entry.condition));
      assert.equal(entry.sha256, hash(await readFile(entry.entry)));
      assert.ok(entry.entry.startsWith(config.native + "/node_modules/") || entry.entry.startsWith(config.pay + "/node_modules/"));
    }
    processRole.identity = { role, pid: identity.pid, identifiedBeforeIo: true, inventory: identity.inventory };
    processRole.send({ type: "start" });
    const ready = await processRole.take("ready");
    assert.ok(Number.isSafeInteger(ready.port) && ready.port >= 0 && ready.port <= 65535);
    if (ready.port) ports.push({ port: ready.port, rebound: false });
    processRole.origin = `https://127.0.0.1:${ready.port}`;
    return processRole;
  }

  async function verifyTls(listeners) {
    const tls = await certificates(config.certificates), allowed = new Set(listeners.map(role => role.origin));
    for (const role of listeners) {
      assert.equal((await tlsFetch(tls.ca, allowed)(role.origin + "/health")).status, 200);
      await assert.rejects(tlsFetch(tls.wrongCa, allowed)(role.origin + "/health"));
      tlsControls.push({ port: Number(new URL(role.origin).port), trusted: true, wrongCaRejected: true });
    }
  }

  async function closeRoles(listeners) {
    for (const role of listeners) { role.send({ type: "close" }); await role.take("closed"); assert.deepEqual(await role.close, { code: 0, signal: null, reason: null }); }
  }

  async function cleanup() {
    for (const role of roles) await role.stop();
    for (const port of ports) {
      const probe = net.createServer(); probe.listen(port.port, "127.0.0.1"); await once(probe, "listening"); await new Promise(resolve => probe.close(resolve)); port.rebound = true;
    }
    return roles.map(role => ({ role: role.role, pid: role.child.pid, ...(role.expectedSupportedWarning ? { expectedSupportedWarning: 1 } : {}), ...Object.fromEntries(Object.entries(role.streams).map(([name, chunks]) => { const bytes = Buffer.concat(chunks); return [name, { bytes: bytes.length, sha256: hash(bytes) }]; })) }));
  }

  return { roles, ports, tlsControls, spawnRole, verifyTls, closeRoles, cleanup };
}
