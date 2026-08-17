import { readFile } from "node:fs/promises";

const files = [
  "README.md",
  "docs/protocol-selection-and-recovery.md",
  "docs/generated-support.md",
];

const bodies = await Promise.all(
  files.map(async (file) => [
    file,
    await readFile(new URL(`../${file}`, import.meta.url), "utf8"),
  ]),
);

for (const [file, body] of bodies) {
  if (/\bx401\b/i.test(body)) {
    throw new Error(`${file} uses x401; the protocol name is x402`);
  }
}

const recovery = bodies.find(
  ([file]) => file === "docs/protocol-selection-and-recovery.md",
)?.[1];
if (!recovery) throw new Error("Missing protocol selection and recovery doc");

const openings = recovery.match(/^```mermaid\s*$/gm)?.length ?? 0;
const blocks = [...recovery.matchAll(/^```mermaid\s*\n([\s\S]*?)^```\s*$/gm)].map(
  (match) => match[1],
);
if (openings !== blocks.length) {
  throw new Error("protocol-selection-and-recovery.md has an unclosed Mermaid block");
}

const sequence = blocks.find((block) =>
  block.trimStart().startsWith("sequenceDiagram"),
);
if (!sequence) {
  throw new Error("protocol-selection-and-recovery.md needs a sequence diagram");
}

for (const marker of ["saveIfAbsent", "fallback", "resume()", "receipt", "clear("]) {
  if (!sequence.toLowerCase().includes(marker.toLowerCase())) {
    throw new Error(`SDK recovery sequence is missing ${marker}`);
  }
}

process.stdout.write("Pay manual docs check passed.\n");
