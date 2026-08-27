import readChangesets from "@changesets/read";
import { readFile } from "node:fs/promises";
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

  let changesets;
  try {
    changesets = await readChangesets(repositoryRoot);
  } catch (error) {
    throw new Error(
      `Generic release cannot read Changesets: ${error instanceof Error ? error.message : "unknown parse failure"}`,
      { cause: error },
    );
  }
  for (const changeset of changesets) {
    if (changeset.releases.some(({ name }) => name === PAY_PACKAGE)) {
      throw new Error(
        `Generic release refuses ${PAY_PACKAGE} candidate in .changeset/${changeset.id}.md; use pay-publish.yml`,
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
