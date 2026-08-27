import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PAY_PACKAGE = "@0xkey-io/pay";

function parseRoot(arguments_) {
  if (arguments_.length === 0) {
    return fileURLToPath(new URL("../../../", import.meta.url));
  }
  if (arguments_.length === 2 && arguments_[0] === "--root") {
    return resolve(arguments_[1]);
  }
  throw new Error("Usage: check-generic-release-exclusion.mjs [--root PATH]");
}

function changesetNames(source) {
  const frontmatter = source.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/)?.[1];
  if (!frontmatter) return [];
  return [
    ...frontmatter.matchAll(/^\s*["']?([^"']+?)["']?\s*:\s*\w+\s*$/gm),
  ].map((match) => match[1].trim());
}

export async function assertGenericReleaseExcludesPay(repositoryRoot) {
  const changesetRoot = resolve(repositoryRoot, ".changeset");
  const config = JSON.parse(
    await readFile(resolve(changesetRoot, "config.json"), "utf8"),
  );
  if (!Array.isArray(config.ignore) || !config.ignore.includes(PAY_PACKAGE)) {
    throw new Error(
      `Generic release is disabled: Changesets must ignore ${PAY_PACKAGE}`,
    );
  }

  const entries = await readdir(changesetRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const source = await readFile(resolve(changesetRoot, entry.name), "utf8");
    if (changesetNames(source).includes(PAY_PACKAGE)) {
      throw new Error(
        `Generic release refuses ${PAY_PACKAGE} candidate in .changeset/${entry.name}; use pay-publish.yml`,
      );
    }
  }

  process.stdout.write(`Generic release excludes ${PAY_PACKAGE}\n`);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  assertGenericReleaseExcludesPay(parseRoot(process.argv.slice(2))).catch(
    (error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Release guard failed"}\n`,
      );
      process.exitCode = 1;
    },
  );
}
