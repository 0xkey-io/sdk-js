import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Release builds forward console output to the device log, so example code
// must never pass OTP codes, contacts, tokens, session keys or exported key
// material to console.*.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_DIRS = ["app", "components", "constants", "hooks"];
const SENSITIVE =
  /otp_?(code|id)|codeToVerify|email|contact|phone|token|session_?key|mnemonic|private_?key|exported|bundle|secret|password|credential/i;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

// Returns the argument text of every console.* call, with string literals
// removed so only referenced identifiers remain (template expressions kept).
function consoleArguments(source) {
  const calls = [];
  const start = /console\.(log|info|debug|warn|error|trace)\s*\(/g;
  for (let match; (match = start.exec(source)); ) {
    let depth = 1;
    let i = start.lastIndex;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        for (i += 1; i < source.length && source[i] !== ch; i += 1) {
          if (source[i] === "\\") i += 1;
        }
      } else if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      i += 1;
    }
    calls.push(
      source
        .slice(start.lastIndex, i - 1)
        .replace(/`(?:[^`\\]|\\.)*`/g, (t) =>
          (t.match(/\$\{[^}]*\}/g) ?? []).join(" "),
        )
        .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ""),
    );
  }
  return calls;
}

test("finds the example's console calls (guards against a vacuous scan)", () => {
  const total = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)))
    .map((file) => consoleArguments(readFileSync(file, "utf8")).length)
    .reduce((a, b) => a + b, 0);
  assert.ok(total >= 10, `expected console calls, found ${total}`);
});

test("flags a console call that logs an OTP code or contact", () => {
  const [args] = consoleArguments(
    'console.log("completeOtp", { otpCode: codeToVerify, contact: email });',
  );
  assert.match(args, SENSITIVE);
  const [safe] = consoleArguments('console.log("Sent OTP to email", { a });');
  assert.doesNotMatch(safe, SENSITIVE);
});

test("example screens never log OTP codes, contacts, tokens, session keys or key material", () => {
  const offenders = [];
  for (const file of SOURCE_DIRS.flatMap((dir) =>
    sourceFiles(join(ROOT, dir)),
  )) {
    for (const args of consoleArguments(readFileSync(file, "utf8"))) {
      const hit = args.match(SENSITIVE);
      if (hit) offenders.push(`${relative(ROOT, file)}: ${hit[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});
