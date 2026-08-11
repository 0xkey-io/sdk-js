#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = process.cwd();
const sourceRoot = path.join(packageRoot, "src", "verifier", "artifacts");
const pr002Root = path.join(sourceRoot, "pr002");
const destinationRoot = path.join(packageRoot, "dist", "commerce-verifier", "artifacts");
const manifest = new Uint8Array(readFileSync(path.join(pr002Root, "bundle-manifest.json")));
const files = Object.fromEntries(
  readdirSync(pr002Root)
    .filter((file) => file !== "bundle-manifest.json")
    .sort()
    .map((file) => [file, new Uint8Array(readFileSync(path.join(pr002Root, file)))]),
);
const sdk = await import(pathToFileURL(path.join(packageRoot, "dist", "index.mjs")).href);
const artifactResult = sdk.verifyCommerceVerifierBundle(manifest, files);
if (!artifactResult.valid) throw new Error("ARTIFACT_INTEGRITY_FAILED");
const bootVector = readFileSync(path.join(sourceRoot, "boot-v1.json"));
const bootDigest = `sha256:${createHash("sha256").update(bootVector).digest("hex")}`;
if (bootDigest !== sdk.COMMERCE_VERIFIER_METADATA.bootVectorDigest) {
  throw new Error("ARTIFACT_INTEGRITY_FAILED");
}
for (const [file, expected] of [
  ["eip3009-wrong-signer.json", sdk.COMMERCE_VERIFIER_METADATA.wrongSignerVectorDigest],
  ["conformance-v1.json", sdk.COMMERCE_VERIFIER_METADATA.conformanceCorpusDigest],
  ["conformance-report.jsonl", sdk.COMMERCE_VERIFIER_METADATA.conformanceReportDigest],
]) {
  const actual = `sha256:${createHash("sha256").update(readFileSync(path.join(sourceRoot, file))).digest("hex")}`;
  if (actual !== expected) throw new Error("ARTIFACT_INTEGRITY_FAILED");
}
rmSync(destinationRoot, { recursive: true, force: true });
mkdirSync(destinationRoot, { recursive: true });
cpSync(sourceRoot, destinationRoot, { recursive: true });
process.stdout.write(`${JSON.stringify({
  bundleDigest: sdk.COMMERCE_VERIFIER_METADATA.artifactBundleDigest,
  bootVectorDigest: bootDigest,
})}\n`);
