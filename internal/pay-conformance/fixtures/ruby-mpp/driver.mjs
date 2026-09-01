import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const [bundleRoot, consumerRoot, certificateRoot, evidenceDirectory] = process.argv.slice(2);
assert.ok(bundleRoot && consumerRoot && certificateRoot && evidenceDirectory, "RUBY_DRIVER_USAGE"); await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const fixture = resolve(new URL("./", import.meta.url).pathname);
const rubyCommand = ["/opt/homebrew/opt/ruby/bin/bundle", "exec", "/opt/homebrew/opt/ruby/bin/ruby", join(fixture, "server.rb"), resolve(certificateRoot)];
const ruby = spawn(rubyCommand[0], rubyCommand.slice(1), { cwd: fixture, detached: true, env: { PATH: "/opt/homebrew/opt/ruby/bin:/opt/homebrew/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C", BUNDLE_GEMFILE: join(fixture, "Gemfile"), BUNDLE_PATH: resolve(bundleRoot), BUNDLE_FROZEN: "true", BUNDLE_DISABLE_SHARED_GEMS: "true", BUNDLE_IGNORE_CONFIG: "true" }, stdio: ["ignore", "pipe", "pipe"] });
const rubyOut = [], rubyErr = []; ruby.stdout.on("data", chunk => rubyOut.push(chunk)); ruby.stderr.on("data", chunk => rubyErr.push(chunk));
const lines = createInterface({ input: ruby.stdout });
const ready = await Promise.race([onceLine(lines), new Promise((_, reject) => setTimeout(() => reject(new Error("RUBY_READY_TIMEOUT")), 30_000))]);
const event = JSON.parse(ready); assert.deepEqual([event.type, event.version], ["ready", "0.1.5"], "RUBY_READY");
const origin = `https://127.0.0.1:${event.port}/paid`;
const clientCommand = [process.execPath, join(fixture, "client.mjs"), resolve(consumerRoot), resolve(certificateRoot), origin];
const client = spawn(clientCommand[0], clientCommand.slice(1), { cwd: resolve(evidenceDirectory), detached: true, env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] });
const clientOut = [], clientErr = []; client.stdout.on("data", chunk => clientOut.push(chunk)); client.stderr.on("data", chunk => clientErr.push(chunk));
const clientClosed = await close(client, 90_000); const rubyClosed = await close(ruby, 90_000); lines.close();
const out = Buffer.concat(clientOut), err = Buffer.concat(clientErr), rout = Buffer.concat(rubyOut), rerr = Buffer.concat(rubyErr);
await writeFile(join(evidenceDirectory, "client.stdout.jsonl"), out, { flag: "wx", mode: 0o600 }); await writeFile(join(evidenceDirectory, "client.stderr.txt"), err, { flag: "wx", mode: 0o600 }); await writeFile(join(evidenceDirectory, "server.stdout.jsonl"), rout, { flag: "wx", mode: 0o600 }); await writeFile(join(evidenceDirectory, "server.stderr.txt"), rerr, { flag: "wx", mode: 0o600 });
assert.deepEqual([clientClosed.code, clientClosed.signal, clientClosed.groupAbsent, err.length], [0, null, true, 0], "RUBY_CLIENT_PROCESS"); assert.deepEqual([rubyClosed.code, rubyClosed.signal, rubyClosed.groupAbsent, rerr.length], [0, null, true, 0], "RUBY_SERVER_PROCESS");
assert.equal(JSON.parse(out.toString()).status, "PASSED", "RUBY_CLIENT_RESULT"); const passed = rout.toString().trim().split("\n").map(JSON.parse).find(value => value.type === "PASSED"); assert.deepEqual([passed.requests, passed.paid, passed.verify, passed.settle], [2, 1, 1, 1], "RUBY_SERVER_RESULT");
const observation = { status: "PASSED", command: { server: rubyCommand, client: clientCommand }, observedVersions: { "mpp-rb": "0.1.5" }, artifactVersion: "1.0.0-rc.1", counts: passed, groupAbsent: true, network: "loopback_no_chain", externalMutations: false };
await writeFile(join(evidenceDirectory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 }); process.stdout.write(JSON.stringify(observation) + "\n");

function onceLine(lines) { return new Promise((accept, reject) => { lines.once("line", accept); lines.once("error", reject); }); }
async function close(child, timeoutMs) { let timedOut = false; const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, timeoutMs); const value = child.exitCode !== null ? { code: child.exitCode, signal: child.signalCode } : await new Promise((accept, reject) => { child.once("error", reject); child.once("close", (code, signal) => accept({ code, signal })); }); clearTimeout(timer); let groupAbsent = false; try { process.kill(-child.pid, 0); } catch (error) { groupAbsent = error?.code === "ESRCH"; } assert.equal(timedOut, false, "RUBY_TIMEOUT"); return { ...value, groupAbsent }; }
