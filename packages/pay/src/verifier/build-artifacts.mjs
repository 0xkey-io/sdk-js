import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "artifacts", "pr002");
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const jcs = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(",")}}`;
};

const files = readdirSync(root)
  .filter((file) => file !== "bundle-manifest.json")
  .sort()
  .map((file) => {
    const bytes = readFileSync(path.join(root, file));
    return { path: file, bytes: bytes.byteLength, sha256: sha256(bytes) };
  });
const frame = {
  formatVersion: 1,
  protocolVersion: "0.1.0-draft.4",
  releaseCandidate: "AC-M0-PR-002/accepted",
  sourceDigest: "sha256:0069b449f4b0f2f2ae88103219a182703498231b3e7cbe6d76cdd7e3f195ff27",
  wireVersion: "0.1",
  files,
};
const manifest = { ...frame, bundleDigest: sha256(jcs(frame)) };
writeFileSync(path.join(root, "bundle-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${manifest.bundleDigest}\n`);
