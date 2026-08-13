#!/usr/bin/env node

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const packageRoot = process.cwd();
const sourceRoot = path.join(
  packageRoot,
  "src",
  "commerce",
  "generated",
  "rc-bundle",
);
const destinationRoot = path.join(
  packageRoot,
  "dist",
  "commerce-contract",
  "rc-bundle",
);
const manifestBytes = readFileSync(
  path.join(sourceRoot, "bundle-manifest.json"),
);
const entries = readdirSync(sourceRoot, { withFileTypes: true });
if (entries.some((entry) => !entry.isFile()))
  throw new Error("CONTRACT_DIGEST_MISMATCH");
const fileNames = entries
  .map((entry) => entry.name)
  .filter((name) => name !== "bundle-manifest.json")
  .sort();
const files = Object.fromEntries(
  fileNames.map((fileName) => [
    fileName,
    new Uint8Array(readFileSync(path.join(sourceRoot, fileName))),
  ]),
);

const sdk = await import(
  pathToFileURL(path.join(packageRoot, "dist", "index.mjs")).href
);
sdk.commerceContract.verifyBundle(new Uint8Array(manifestBytes), files);
const manifest = JSON.parse(manifestBytes.toString("utf8"));

rmSync(destinationRoot, { recursive: true, force: true });
mkdirSync(destinationRoot, { recursive: true });
cpSync(sourceRoot, destinationRoot, { recursive: true });
process.stdout.write(
  `${JSON.stringify({
    bundleDigest: sdk.COMMERCE_CONTRACT_METADATA.bundleDigest,
    files: manifest.files.length,
  })}\n`,
);
