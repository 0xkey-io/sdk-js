import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { validateExecutionInput as validate, readExecutionInput } from "../src/execution-input.mjs";
const input = { stage: "development-only", fixture: "x402-2.23", native: "/owned/native", certificates: "/owned/certs", corepack: "/owned/corepack", evidence: "/owned/evidence", consumer: { directory: "/owned/consumer", artifact: "/owned/artifact.tgz", artifactSha256: "1".repeat(64) } };

for (const [label, change] of [
  ["unknown metadata", { credential: "SYNTHETIC_INPUT_SECRET" }],
  ["unapproved stage", { stage: "SYNTHETIC_INPUT_SECRET" }],
  ["coercible stage", { stage: ["development-only"] }],
  ["unimplemented fixture", { fixture: "go-x402" }],
  ["coercible fixture", { fixture: ["x402-2.23"] }],
  ["relative native input", { native: "owned/native" }],
  ["normalized alias", { native: "/owned/../owned/native" }],
  ["URL instead of path", { native: "https://example.invalid/fixture" }],
  ["unknown artifact metadata", { consumer: { ...input.consumer, integrity: "caller-selected" } }],
  ["missing artifact hash", { consumer: { ...input.consumer, artifactSha256: undefined } }],
  ["coercible artifact hash", { consumer: { ...input.consumer, artifactSha256: [input.consumer.artifactSha256] } }],
  ["unbounded path", { evidence: "/" + "a".repeat(4097) }],
]) test(`execution input rejects ${label} without retaining payload`, () => {
  assert.throws(() => validate({ ...input, ...change }), error => error.message === "EXECUTION_INPUT_REJECTED" && !String(error).includes("SYNTHETIC_INPUT_SECRET"));
});

test("the exact native execution envelope is cloned with no arbitrary stage claims", () => {
  const result = validate(input); assert.deepEqual(result, input); assert.notEqual(result, input);
  for (const fixture of ["x402-2.23", "x402-2.22", "mppx-0.8.19", "mppx-0.8.17", "x402-framework-2.23", "x402-framework-2.22"]) assert.equal(validate({ ...input, fixture, stage: "final-7b" }).fixture, fixture);
});

async function files() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pay-execution-input-")));
  for (const name of ["native", "certs", "corepack", "evidence", "consumer"]) await mkdir(join(root, name));
  const value = { ...input, native: join(root, "native"), certificates: join(root, "certs"), corepack: join(root, "corepack"), evidence: join(root, "evidence"), consumer: { ...input.consumer, directory: join(root, "consumer"), artifact: join(root, "artifact.tgz") } };
  return { root, value, async write(name, data = value) { const file = join(root, name); const bytes = typeof data === "string" ? data : JSON.stringify(data); await writeFile(file, bytes, { flag: "wx", mode: 0o600 }); return { file, bytes }; } };
}

test("input bytes are bounded, canonical and bound by their actual digest", async () => {
  const fixture = await files(), { file, bytes } = await fixture.write("input.json");
  assert.deepEqual(await readExecutionInput(file), { input: fixture.value, inputSha256: createHash("sha256").update(bytes).digest("hex") });
  const alias = join(fixture.root, "alias.json"); await symlink(file, alias);
  await assert.rejects(readExecutionInput(alias), { message: "EXECUTION_INPUT_REJECTED" });
  for (const [name, data] of [["large.json", "x".repeat(32769)], ["invalid.json", "SYNTHETIC_INPUT_SECRET"], ["extra.json", { ...fixture.value, secret: "SYNTHETIC_INPUT_SECRET" }]]) {
    await assert.rejects(readExecutionInput((await fixture.write(name, data)).file), { message: "EXECUTION_INPUT_REJECTED" });
  }
});

test("evidence writes cannot overlap any retained input or installed owner tree", async () => {
  const fixture = await files();
  for (const [index, evidence] of [fixture.value.native, fixture.value.certificates, fixture.value.corepack, fixture.value.consumer.directory, fixture.root].entries()) {
    const { file } = await fixture.write(`overlap-${index}.json`, { ...fixture.value, evidence });
    await assert.rejects(readExecutionInput(file), { message: "EXECUTION_INPUT_REJECTED" });
  }
});

test("selected native owner cannot alias the packed consumer installation", async () => {
  const fixture = await files();
  const { file } = await fixture.write("same-owner.json", { ...fixture.value, native: fixture.value.consumer.directory });
  await assert.rejects(readExecutionInput(file), { message: "EXECUTION_INPUT_REJECTED" });
});
