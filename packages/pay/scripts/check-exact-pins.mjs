import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const expected = {
  "@x402/evm": "2.23.0",
  "@x402/fetch": "2.23.0",
};

for (const [name, version] of Object.entries(expected)) {
  if (packageJson.dependencies?.[name] !== version) {
    throw new Error(`${name} must be pinned to ${version}`);
  }
}

for (const [name, version] of [["mppx", "0.8.19"], ["@x402/core", "2.23.0"]]) {
  for (const group of ["peerDependencies", "devDependencies"]) {
    if (packageJson[group]?.[name] !== version) {
      throw new Error(`${group}.${name} must be pinned to ${version}`);
    }
  }
}

if (packageJson.peerDependencies?.viem !== ">=2.54.0 <3") {
  throw new Error("peerDependencies.viem must preserve >=2.54.0 <3");
}

process.stdout.write("Pay protocol dependency pins are exact.\n");
