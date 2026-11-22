#!/usr/bin/env node
// Fails when a tracked file mentions the upstream brand outside the allowlist.
//
// Every tracked text file is searched case-insensitively for the upstream brand name and its GitHub
// organization. A matching line passes only if an entry of scripts/brand-residue-allowlist.txt covers
// it. Entries that no longer match anything also fail, so the allowlist cannot silently grow stale.
//
// Allowlist format, one entry per line (blank lines and `#` comments are ignored):
//
//     <path glob>                  every matching line in the files is allowed
//     <path glob> :: <regex>       only lines matching the JavaScript regex are allowed
//
//     node scripts/check-brand-residue.mjs

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWLIST = join(ROOT, "scripts/brand-residue-allowlist.txt");
const SELF = new Set([
  "scripts/check-brand-residue.mjs",
  "scripts/brand-residue-allowlist.txt",
]);
const PATTERN = new RegExp("turn" + "key|tk" + "hq", "i");

function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      out += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

function loadAllowlist() {
  return readFileSync(ALLOWLIST, "utf8")
    .split("\n")
    .flatMap((raw, index) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return [];
      const sep = line.indexOf(" :: ");
      const glob = (sep === -1 ? line : line.slice(0, sep)).trim();
      const regex = sep === -1 ? null : new RegExp(line.slice(sep + 4).trim());
      return [
        {
          line: index + 1,
          glob,
          match: globToRegExp(glob),
          regex,
          used: false,
        },
      ];
    });
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT })
    .toString()
    .split("\0")
    .filter(Boolean);
}

const entries = loadAllowlist();
const failures = [];
for (const path of trackedFiles()) {
  if (SELF.has(path)) continue;
  const file = join(ROOT, path);
  let stat;
  try {
    stat = lstatSync(file);
  } catch {
    continue;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) continue;
  const data = readFileSync(file);
  if (data.subarray(0, 8192).includes(0)) continue;
  const candidates = entries.filter((e) => e.match.test(path));
  data
    .toString("utf8")
    .split(/\r?\n/)
    .forEach((text, index) => {
      if (!PATTERN.test(text)) return;
      const hit = candidates.find(
        (e) => e.regex === null || e.regex.test(text),
      );
      if (hit) hit.used = true;
      else failures.push(`${path}:${index + 1}: ${text.trim().slice(0, 160)}`);
    });
  if (PATTERN.test(path)) {
    const whole = candidates.find((e) => e.regex === null);
    if (whole) whole.used = true;
    else failures.push(`${path}: upstream brand in the file name`);
  }
}

const stale = entries.filter((e) => !e.used);
if (failures.length) {
  console.error(
    `${failures.length} line(s) name the upstream brand outside ${relative(ROOT, ALLOWLIST)}:`,
  );
  console.error(failures.map((f) => `  ${f}`).join("\n"));
}
if (stale.length) {
  console.error("allowlist entries that match nothing (remove them):");
  console.error(stale.map((e) => `  line ${e.line}: ${e.glob}`).join("\n"));
}
if (failures.length || stale.length) process.exit(1);
console.log("brand residue check: ok");
