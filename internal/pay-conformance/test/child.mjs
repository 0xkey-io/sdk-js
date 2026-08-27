import { spawn } from "node:child_process";
import { once } from "node:events";
const scenario = process.argv[2];
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");
emit({
  type: "versions",
  versions: {
    node: scenario === "wrong-version" ? "0.0.1" : process.versions.node,
  },
});
await once(process.stdin, "data");
process.stdin.pause();
if (scenario === "timeout-tree") {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import net from 'node:net'; const server=net.createServer();server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({type:'ready',port:server.address().port})));",
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  child.stdout.pipe(process.stdout);
  setInterval(() => {}, 1000);
} else if (scenario.startsWith("coercible-")) {
  const kind = scenario.slice("coercible-".length);
  const field = {
    versions: "versions",
    ready: "port",
    observation: "counters",
    result: "assertions",
  }[kind];
  emit({ type: "ready", port: 0 });
  emit({
    type: [kind],
    [field]: { credential: "synthetic-discriminator-secret-7a" },
  });
  setInterval(() => {}, 1000);
} else {
  emit({ type: "ready", port: 0 });
  if (scenario === "raw-output")
    process.stdout.write("unique-private-sentinel-7a\n");
  if (scenario === "stderr")
    process.stderr.write("unique-private-sentinel-7a\n");
  if (scenario === "duplicate-version")
    emit({ type: "versions", versions: { node: process.versions.node } });
  emit({ type: "observation", counters: { sign: 0 } });
  emit({ type: "result", assertions: 1 });
  process.exitCode = scenario === "failure" ? 3 : 0;
}
