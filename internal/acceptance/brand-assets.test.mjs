import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Byte-identical to 0xkey-io/web apps/website/public/favicon.svg.
const CANONICAL_FAVICON_SHA256 =
  "ccb86ee38212e79988032c7b9c0e1b62462235759e01f75c9629e52b4f11252c";

// Path data of the upstream Turnkey glyph and "turnkey" wordmark.
const TURNKEY_ARTWORK_MARKERS = [
  "M265.8 237.605",
  "M256.337 209.86",
  "mask0_906_38",
  "M91.377 0H95.08v24.697",
  "M91.3775 0H91.6748H94.7821",
];

const SKIPPED_DIRS = new Set(["node_modules", "dist", ".next", ".git"]);

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRS.has(entry.name)) return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

const svgFiles = ["examples", "packages"]
  .flatMap((dir) => listFiles(join(root, dir)))
  .filter((file) => extname(file) === ".svg");

test("example and package SVGs carry no Turnkey artwork", () => {
  const offenders = svgFiles
    .filter((file) => {
      const svg = readFileSync(file, "utf8");
      return TURNKEY_ARTWORK_MARKERS.some((marker) => svg.includes(marker));
    })
    .map((file) => relative(root, file));
  assert.deepEqual(offenders, []);
});

test("example favicons are the canonical 0xkey mark", () => {
  const favicons = svgFiles.filter((file) =>
    file.endsWith("/public/favicon.svg"),
  );
  assert.ok(favicons.length > 0);
  const offenders = favicons
    .filter(
      (file) =>
        createHash("sha256").update(readFileSync(file)).digest("hex") !==
        CANONICAL_FAVICON_SHA256,
    )
    .map((file) => relative(root, file));
  assert.deepEqual(offenders, []);
});
