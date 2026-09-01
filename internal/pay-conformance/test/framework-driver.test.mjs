import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";

for (const version of ["2.23", "2.22"]) test(`x402 framework ${version} has a closed final driver`, async () => {
  const driver = new URL(`../fixtures/x402-framework-${version}/driver.mjs`, import.meta.url);
  await access(driver);
  assert.match(await readFile(driver, "utf8"), /runFrameworkRow/);
});

test("framework final driver dispatches only the implemented row catalog", async () => {
  const source = await readFile(new URL("../fixtures/runtime/framework-driver.mjs", import.meta.url), "utf8");
  for (const marker of ["resource", "http", "express", "hono", "default-authorization-rejection", "wrong-owner-rejection", "mixed-condition-configured", "direct-verify-faults", "next-native-esm-import-rejection"]) assert.match(source, new RegExp(marker));
  assert.match(source, /FRAMEWORK_ROW_NOT_IMPLEMENTED/);
  assert.match(source, /final-7b/);
});

test("framework owner rows keep default rejection distinct from configured direct faults", async () => {
  const source = await readFile(new URL("../fixtures/runtime/framework-driver.mjs", import.meta.url), "utf8");
  assert.match(source, /"default-authorization-rejection": \["import", "import", "omitted", "unsafe"\]/);
  assert.match(source, /"direct-verify-faults": \["import", "import", "configured", "safe"\]/);
});

test("typed framework rows compile the public recipe with a closed Bundler graph", async () => {
  const source = await readFile(new URL("../fixtures/runtime/framework-driver.mjs", import.meta.url), "utf8");
  assert.match(source, /moduleResolution: "Bundler"/);
  assert.match(source, /strict: true/);
  assert.match(source, /spawnSync\(process\.execPath/);
  assert.match(source, /"@types\/node", "@types\/react"/);
});

test("Next build rows bind import and require routes to offline webpack builds", async () => {
  const source = await readFile(new URL("../fixtures/runtime/framework-driver.mjs", import.meta.url), "utf8");
  assert.match(source, /next-build-\(import\|require\)-upfront-injection/);
  assert.match(source, /"build", "--webpack"/);
  assert.match(source, /COREPACK_ENABLE_NETWORK: "0"/);
  assert.match(source, /exportIdentity\(input\.native, "@x402\/next", condition\)/);
  assert.match(source, /serverFilesSha256: hash\(JSON\.stringify\(serverFiles\)\)/);
  assert.match(source, /app\/paid\/route\.js/);
  assert.match(source, /details: \{ condition, preflight:/);
  await access(new URL("../../../packages/pay/scripts/fixtures/x402-next/route-require.js", import.meta.url));
  await access(new URL("../../../packages/pay/scripts/fixtures/x402-next/x402-upfront-require.js", import.meta.url));
});
