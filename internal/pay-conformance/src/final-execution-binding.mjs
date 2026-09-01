import assert from "node:assert/strict";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyConsumer } from "./consumer.mjs";
import { sha256 } from "./redact.mjs";

const sdk = fileURLToPath(new URL("../../../", import.meta.url));
const roots = [
  fileURLToPath(new URL("../src/", import.meta.url)),
  fileURLToPath(new URL("../fixtures/runtime/", import.meta.url)),
  fileURLToPath(new URL("../test/integration/", import.meta.url)),
  fileURLToPath(new URL("../../../packages/pay/src/", import.meta.url)),
  fileURLToPath(new URL("../../../packages/pay/scripts/", import.meta.url)),
];

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else { assert.equal(entry.isFile(), true, "FINAL_SOURCE_NON_FILE"); result.push(path); }
    assert.ok(result.length <= 2048, "FINAL_SOURCE_LIMIT");
  }
  return result;
}

async function sourceSnapshot() {
  const paths = (await Promise.all(roots.map(files))).flat().sort();
  const entries = [];
  for (const path of paths) {
    const stat = await lstat(path);
    assert.equal(stat.isFile(), true, "FINAL_SOURCE_NON_FILE");
    entries.push({ path: relative(sdk, path), bytes: stat.size, sha256: sha256(await readFile(path)) });
  }
  return { entries, sha256: sha256(JSON.stringify(entries)) };
}

export async function prepareFinalExecutionBinding({ inputPath, input }) {
  const inputBytes = await readFile(inputPath);
  const artifactBytes = await readFile(input.consumer.artifact);
  assert.equal(sha256(artifactBytes), input.consumer.artifactSha256, "FINAL_ARTIFACT_DRIFT");
  const consumerIdentity = await verifyConsumer(input.consumer, true);
  return {
    inputPath,
    artifactPath: input.consumer.artifact,
    inputBytes,
    inputSha256: sha256(inputBytes),
    artifactSha256: sha256(artifactBytes),
    consumerIdentity,
    sources: await sourceSnapshot(),
  };
}

export async function retainFinalExecutionBinding({ binding, directory, observed }) {
  assert.equal(sha256(await readFile(binding.inputPath)), binding.inputSha256, "FINAL_INPUT_DRIFT");
  assert.equal(sha256(await readFile(binding.artifactPath)), binding.artifactSha256, "FINAL_ARTIFACT_DRIFT");
  assert.equal(observed.inputSha256, binding.inputSha256, "FINAL_CHILD_INPUT_MISMATCH");
  assert.equal(observed.artifactSha256, binding.artifactSha256, "FINAL_CHILD_ARTIFACT_MISMATCH");
  assert.deepEqual(observed.consumerIdentity, binding.consumerIdentity, "FINAL_CHILD_CONSUMER_MISMATCH");
  const after = await sourceSnapshot();
  assert.deepEqual(after, binding.sources, "FINAL_SOURCE_DRIFT");
  await writeFile(join(directory, "execution-input.json"), binding.inputBytes, { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "execution-binding.json"), JSON.stringify({
    inputSha256: binding.inputSha256,
    artifactSha256: binding.artifactSha256,
    consumerIdentity: binding.consumerIdentity,
    sources: binding.sources,
  }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
