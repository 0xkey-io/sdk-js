import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertGenericReleaseExcludesPay } from "./check-generic-release-exclusion.mjs";

const PAY_PACKAGE = "@0xkey-io/pay";

function runChangesets(repositoryRoot) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", ["exec", "changeset", "publish"], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          signal
            ? `Changesets publisher terminated by ${signal}`
            : `Changesets publisher exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

export async function publishGenericRelease({
  repositoryRoot,
  publish = () => runChangesets(repositoryRoot),
}) {
  await assertGenericReleaseExcludesPay(repositoryRoot);
  const manifestPath = resolve(repositoryRoot, "packages/pay/package.json");
  const originalSource = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(originalSource);
  if (manifest.name !== PAY_PACKAGE || manifest.private !== true) {
    throw new Error(
      `Expected permanently private ${PAY_PACKAGE} source manifest`,
    );
  }
  let publishFailure;
  try {
    await publish();
  } catch (error) {
    publishFailure = error;
  }
  if ((await readFile(manifestPath, "utf8")) !== originalSource) {
    throw new Error(
      `${PAY_PACKAGE} source manifest changed during generic publish`,
    );
  }
  if (publishFailure) throw publishFailure;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  publishGenericRelease({ repositoryRoot }).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Generic publish failed"}\n`,
    );
    process.exitCode = 1;
  });
}
