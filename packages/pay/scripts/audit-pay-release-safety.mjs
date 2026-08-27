import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

const PAY_PACKAGE = "@0xkey-io/pay";
const SKIPPED_DOCUMENT_DIRECTORIES = new Set([
  ".cache",
  ".changeset",
  ".git",
  ".superpowers",
  "dist",
  "node_modules",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function commandInvokesScript(command, scriptName) {
  const name = escapeRegExp(scriptName);
  return [
    new RegExp(
      `\\bpnpm\\s+(?:-w\\s+)?run\\s+(?:-w\\s+)?${name}(?=\\s|$|[;&|])`,
    ),
    new RegExp(`\\bnpm\\s+run\\s+${name}(?=\\s|$|[;&|])`),
    new RegExp(`\\bpnpm\\s+(?:-w\\s+)?${name}(?=\\s|$|[;&|])`),
  ].some((pattern) => pattern.test(command));
}

function shellFragments(command) {
  return command
    .replace(/\\\r?\n\s*/g, " ")
    .split(/\r?\n|&&|\|\||;/)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
}

function fragmentDirectlyExecutesPay(command) {
  const payExclusion = /--filter(?:=|\s+)["']?!@0xkey-io\/pay["']?/;
  const excludesPay = payExclusion.test(command);
  const withoutPayExclusion = command.replace(
    /--filter(?:=|\s+)["']?!@0xkey-io\/pay["']?/g,
    "",
  );
  if (
    /@0xkey-io\/pay(?![\w-])|(?:^|[\s"'])packages\/pay(?:[\s/"']|$)|\bpay-v1-uat\b|\bwith-x402\b|publish-generic-release\.mjs|check-generic-release-exclusion\.mjs/.test(
      withoutPayExclusion,
    )
  ) {
    return true;
  }
  if (excludesPay) return false;
  return (
    /(?:^|\s)(?:-r|--recursive)(?:\s|$)/.test(command) ||
    /--filter(?:=|\s+)["']?\.\/packages\/\*{1,2}["']?/.test(command) ||
    /\bturbo\b[^\n]*--filter(?:=|\s+)["']?\.\/packages\/\*{1,2}["']?/.test(
      command,
    ) ||
    /\bchangeset\s+(?:version|publish)\b/.test(command)
  );
}

function commandDirectlyExecutesPay(command) {
  return shellFragments(command).some(fragmentDirectlyExecutesPay);
}

function payExecutingAliases(rootScripts) {
  const aliases = new Set(
    Object.entries(rootScripts)
      .filter(([, command]) => commandDirectlyExecutesPay(command))
      .map(([name]) => name),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, command] of Object.entries(rootScripts)) {
      if (aliases.has(name)) continue;
      if ([...aliases].some((alias) => commandInvokesScript(command, alias))) {
        aliases.add(name);
        changed = true;
      }
    }
  }
  return aliases;
}

function commandExecutesPay(command, aliases) {
  return (
    commandDirectlyExecutesPay(command) ||
    [...aliases].some((alias) => commandInvokesScript(command, alias))
  );
}

function nodeSelection(step, rootNodeVersion) {
  if (!step || typeof step !== "object" || typeof step.uses !== "string") {
    return undefined;
  }
  const with_ = step.with && typeof step.with === "object" ? step.with : {};
  if (step.uses === "./.github/actions/js-setup") {
    return {
      selected: with_["node-version"] ?? rootNodeVersion,
      source: step.uses,
    };
  }
  if (/^actions\/setup-node@/.test(step.uses)) {
    if (with_["node-version"] !== undefined) {
      return { selected: with_["node-version"], source: step.uses };
    }
    if (with_["node-version-file"] === ".nvmrc") {
      return { selected: rootNodeVersion, source: ".nvmrc" };
    }
    return { selected: undefined, source: step.uses };
  }
  return undefined;
}

function supportedNodeVersion(selection) {
  if (typeof selection !== "string" && typeof selection !== "number") {
    return { supported: false, reason: "cannot prove Node version" };
  }
  const value = String(selection).trim();
  if (value.includes("${{")) {
    return { supported: false, reason: `cannot prove Node from ${value}` };
  }
  const match = /^v?(\d+)(?:\.(\d+)(?:\.\d+)?)?$/.exec(value);
  if (!match) {
    return { supported: false, reason: `cannot prove Node from ${value}` };
  }
  const major = Number(match[1]);
  const minor = match[2] === undefined ? undefined : Number(match[2]);
  if (major > 22 || (major === 22 && minor !== undefined && minor >= 12)) {
    return { supported: true };
  }
  return { supported: false, reason: `unsupported Node ${value}` };
}

export function auditWorkflowSource({
  name,
  source,
  rootScripts,
  rootNodeVersion,
}) {
  let workflow;
  try {
    workflow = parseYaml(source);
  } catch (error) {
    throw new Error(
      `${name}: cannot parse workflow YAML: ${error instanceof Error ? error.message : "unknown error"}`,
      { cause: error },
    );
  }
  if (!workflow || typeof workflow !== "object" || !workflow.jobs) {
    throw new Error(`${name}: workflow has no jobs mapping`);
  }
  const aliases = payExecutingAliases(rootScripts);
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    const steps =
      job && typeof job === "object" && Array.isArray(job.steps)
        ? job.steps
        : [];
    const payStepIndexes = steps.flatMap((step, index) =>
      step &&
      typeof step === "object" &&
      typeof step.run === "string" &&
      commandExecutesPay(step.run, aliases)
        ? [index]
        : [],
    );
    if (payStepIndexes.length === 0) continue;

    const setups = steps.flatMap((step, index) => {
      const selection = nodeSelection(step, rootNodeVersion);
      return selection ? [{ ...selection, index }] : [];
    });
    for (const setup of setups) {
      const result = supportedNodeVersion(setup.selected);
      if (!result.supported) {
        throw new Error(`${name} job ${jobName}: ${result.reason}`);
      }
    }
    for (const payStepIndex of payStepIndexes) {
      const activeSetup = setups
        .filter(({ index }) => index < payStepIndex)
        .at(-1);
      if (!activeSetup) {
        throw new Error(
          `${name} job ${jobName}: Pay executes before a supported Node setup`,
        );
      }
    }
  }
}

export function auditPublishText({ name, source }) {
  const normalized = source.replace(/\\\r?\n\s*/g, " ");
  for (const match of normalized.matchAll(
    /\bpnpm\b(?=[^\n]*\bpublish\b)(?=[^\n]*(?:\s-r\b|--recursive\b))[^\n]*/g,
  )) {
    if (!/--filter(?:=|\s+)["']?!@0xkey-io\/pay["']?/.test(match[0])) {
      throw new Error(`${name}: recursive publish must exclude ${PAY_PACKAGE}`);
    }
  }
  if (/\bpnpm\s+exec\s+changeset\s+publish\b/.test(normalized)) {
    throw new Error(`${name}: raw Changesets publish bypasses the Pay wrapper`);
  }
  if (/(?:^|\n)\s*(?:run:\s*)?npm\s+publish\b/.test(normalized)) {
    if (
      !name.endsWith(".github/workflows/pay-publish.yml") ||
      !/npm\s+publish[\s\S]{0,240}--tag\s+next/.test(normalized)
    ) {
      throw new Error(`${name}: mutable npm publish bypasses pay-publish.yml`);
    }
  }
}

async function markdownFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DOCUMENT_DIRECTORIES.has(entry.name)) {
        files.push(...(await markdownFiles(root, join(directory, entry.name))));
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

export async function auditRepositoryReleaseSafety(repositoryRoot) {
  const [manifestSource, rootNodeVersion, setupSource] = await Promise.all([
    readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    readFile(resolve(repositoryRoot, ".nvmrc"), "utf8"),
    readFile(
      resolve(repositoryRoot, ".github/actions/js-setup/action.yml"),
      "utf8",
    ),
  ]);
  const rootScripts = JSON.parse(manifestSource).scripts ?? {};
  if (rootNodeVersion.trim() !== "v22.12.0") {
    throw new Error(`.nvmrc must be exactly v22.12.0`);
  }
  const setupAction = parseYaml(setupSource);
  const setupSteps = setupAction?.runs?.steps;
  if (
    !Array.isArray(setupSteps) ||
    !setupSteps.some(
      (step) =>
        /^actions\/setup-node@/.test(step?.uses ?? "") &&
        step?.with?.["node-version-file"] === ".nvmrc",
    )
  ) {
    throw new Error(
      `js-setup must resolve its default Node version from .nvmrc`,
    );
  }

  const workflowRoot = resolve(repositoryRoot, ".github/workflows");
  for (const entry of await readdir(workflowRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
    const name = `.github/workflows/${entry.name}`;
    const source = await readFile(join(workflowRoot, entry.name), "utf8");
    auditWorkflowSource({
      name,
      source,
      rootScripts,
      rootNodeVersion: rootNodeVersion.trim(),
    });
    auditPublishText({ name, source });
  }

  for (const path of await markdownFiles(repositoryRoot)) {
    const name = relative(repositoryRoot, path);
    auditPublishText({ name, source: await readFile(path, "utf8") });
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  auditRepositoryReleaseSafety(repositoryRoot)
    .then(() => process.stdout.write("Pay release safety audit passed.\n"))
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Release safety audit failed"}\n`,
      );
      process.exitCode = 1;
    });
}
