import { readFile, readdir } from "node:fs/promises";
import { join, posix, relative, resolve } from "node:path";
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

function withoutHeredocBodies(source) {
  const output = [];
  let delimiter;
  for (const line of source.split(/\r?\n/)) {
    if (delimiter !== undefined) {
      if (line.trim() === delimiter) delimiter = undefined;
      output.push("");
      continue;
    }
    output.push(line);
    const match = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (match) delimiter = match[2];
  }
  return output.join("\n");
}

function shellFragments(source) {
  const command = withoutHeredocBodies(source).replace(/\\\r?\n\s*/g, " ");
  const fragments = [];
  let current = "";
  let quote;
  let escaped = false;
  let expressionDepth = 0;
  const flush = () => {
    const value = current.trim();
    if (value) fragments.push(value);
    current = "";
  };
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    const next = command[index + 1];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      current += character;
      escaped = true;
      continue;
    }
    if (!quote && command.slice(index, index + 3) === "${{") {
      expressionDepth += 1;
      current += "${{";
      index += 2;
      continue;
    }
    if (
      !quote &&
      expressionDepth > 0 &&
      command.slice(index, index + 2) === "}}"
    ) {
      expressionDepth -= 1;
      current += "}}";
      index += 1;
      continue;
    }
    if (expressionDepth === 0 && (character === "'" || character === '"')) {
      if (quote === character) quote = undefined;
      else if (!quote) quote = character;
      current += character;
      continue;
    }
    if (
      !quote &&
      expressionDepth === 0 &&
      character === "#" &&
      /(^|\s)$/.test(current)
    ) {
      while (index < command.length && command[index] !== "\n") index += 1;
      flush();
      continue;
    }
    if (
      !quote &&
      expressionDepth === 0 &&
      (character === "\n" ||
        character === ";" ||
        character === "&" ||
        character === "|" ||
        character === "(" ||
        character === ")")
    ) {
      flush();
      if ((character === "&" || character === "|") && next === character) {
        index += 1;
      }
      continue;
    }
    current += character;
  }
  flush();
  return fragments;
}

function shellWords(source) {
  const words = [];
  let current = "";
  let quote;
  let escaped = false;
  let expressionDepth = 0;
  const flush = () => {
    if (current) words.push(current);
    current = "";
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (!quote && source.slice(index, index + 3) === "${{") {
      expressionDepth += 1;
      current += "${{";
      index += 2;
      continue;
    }
    if (
      !quote &&
      expressionDepth > 0 &&
      source.slice(index, index + 2) === "}}"
    ) {
      expressionDepth -= 1;
      current += "}}";
      index += 1;
      continue;
    }
    if (expressionDepth === 0 && (character === "'" || character === '"')) {
      if (quote === character) quote = undefined;
      else if (!quote) quote = character;
      else current += character;
      continue;
    }
    if (!quote && expressionDepth === 0 && /\s/.test(character)) {
      flush();
      continue;
    }
    current += character;
  }
  flush();
  return words;
}

function executableWords(source) {
  const words = shellWords(source);
  while (
    words.length > 0 &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) ||
      ["!", "{", "}", "do", "else", "if", "then", "while"].includes(words[0]))
  ) {
    words.shift();
  }
  if (["env", "sudo"].includes(words[0])) words.shift();
  return words;
}

function normalizeRepositoryPath(cwd, value) {
  if (typeof value !== "string" || value.includes("${{")) return undefined;
  const cleaned = value.replace(/^file:/, "").replace(/^\.\//, "");
  const resolved = cleaned.startsWith("/")
    ? posix.normalize(cleaned)
    : posix.normalize(posix.join(cwd, cleaned));
  return resolved.replace(/^\.\//, "");
}

function isPayPath(cwd, value) {
  const resolved = normalizeRepositoryPath(cwd, value);
  return resolved === "packages/pay" || resolved?.startsWith("packages/pay/");
}

function filterValues(words) {
  const values = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--filter" || word === "-F") values.push(words[index + 1]);
    else if (word.startsWith("--filter="))
      values.push(word.slice("--filter=".length));
  }
  return values.filter((value) => typeof value === "string");
}

function isExactPaySelector(value) {
  return /^@0xkey-io\/pay(?:\^?\.\.\.)?$/.test(value);
}

function isExactPayExclusion(value) {
  return value.startsWith("!") && isExactPaySelector(value.slice(1));
}

function hasOption(words, name) {
  return (
    words.includes(name) || words.some((word) => word.startsWith(`${name}=`))
  );
}

function optionValue(words, name) {
  const index = words.indexOf(name);
  if (index >= 0) return words[index + 1];
  const prefix = `${name}=`;
  return words.find((word) => word.startsWith(prefix))?.slice(prefix.length);
}

function shellCommandModels(
  source,
  { cwd = ".", cwdIsUnknown = false, metadata = {}, nestedDepth = 0 } = {},
) {
  const models = [];
  const initialCwd = normalizeRepositoryPath(".", cwd);
  let activeCwd = initialCwd ?? ".";
  let activeCwdUnknown = cwdIsUnknown || initialCwd === undefined;
  for (const fragment of shellFragments(source)) {
    const words = executableWords(fragment);
    if (words[0] === "cd" && words[1]) {
      const nextCwd = normalizeRepositoryPath(activeCwd, words[1]);
      if (nextCwd === undefined) activeCwdUnknown = true;
      else activeCwd = nextCwd;
      continue;
    }
    if (words.length > 0) {
      const model = {
        ...metadata,
        cwd: activeCwd,
        cwdUnknown: activeCwdUnknown,
        source: fragment,
        words,
      };
      models.push(model);
      const commandIndex = ["bash", "sh", "zsh"].includes(words[0])
        ? words.indexOf("-c")
        : -1;
      if (commandIndex >= 0 && words[commandIndex + 1] && nestedDepth < 4) {
        models.push(
          ...shellCommandModels(words[commandIndex + 1], {
            cwd: activeCwd,
            cwdIsUnknown: activeCwdUnknown,
            metadata,
            nestedDepth: nestedDepth + 1,
          }),
        );
      }
    }
  }
  return models;
}

function publishOperation(command) {
  const words = [...command.words];
  const executable = words[0];
  const filters = filterValues(words);
  const excludesPay = filters.some(isExactPayExclusion);
  const selectsPay = filters.some(isExactPaySelector);
  const recursive = hasOption(words, "--recursive") || words.includes("-r");
  const prefix = optionValue(words, "--prefix");
  const cwdTargetsPay =
    isPayPath(".", command.cwd) || (prefix && isPayPath(command.cwd, prefix));
  const changesetIndex = words.findIndex((word) =>
    /^(?:changeset|changesets)$/.test(word),
  );
  if (changesetIndex >= 0 && words[changesetIndex + 1] === "publish") {
    return { kind: "changesets", dryRun: false, targetsPay: true };
  }
  const publishIndex = words.indexOf("publish");
  if (publishIndex < 0 || !["npm", "pnpm"].includes(executable))
    return undefined;
  const target = words
    .slice(publishIndex + 1)
    .find(
      (word) => !word.startsWith("-") && word !== optionValue(words, "--tag"),
    );
  const targetsPay =
    executable === "npm" ||
    cwdTargetsPay ||
    selectsPay ||
    (target
      ? isPayPath(command.cwd, target) || isExactPaySelector(target)
      : false) ||
    (recursive && !excludesPay);
  return {
    kind: executable,
    dryRun: hasOption(words, "--dry-run"),
    excludesPay,
    recursive,
    tag: optionValue(words, "--tag"),
    target,
    targetsPay,
  };
}

function selectorCanIncludePay(value) {
  return (
    isExactPaySelector(value) ||
    /^(?:\.\/)?packages\/\*{1,2}$/.test(value) ||
    /^(?:\.\/)?packages\/pay(?:\/.*)?$/.test(value)
  );
}

function commandModelDirectlyExecutesPay(command) {
  const words = command.words;
  const executable = words[0];
  if (["echo", "printf"].includes(executable)) return false;
  if (
    command.cwdUnknown &&
    ["node", "npm", "npx", "pnpm", "tsx", "turbo"].includes(executable)
  ) {
    return true;
  }
  const filters = filterValues(words);
  const excludesPay = filters.some(isExactPayExclusion);
  if (
    filters.some(
      (value) => !value.startsWith("!") && selectorCanIncludePay(value),
    )
  ) {
    return true;
  }
  if (
    words.some(
      (word) =>
        isExactPaySelector(word) ||
        isPayPath(command.cwd, word) ||
        ["pay-v1-uat", "with-x402"].includes(word) ||
        /(?:publish-generic-release|check-generic-release-exclusion)\.mjs$/.test(
          word,
        ),
    )
  ) {
    return true;
  }
  if (
    isPayPath(".", command.cwd) &&
    ["node", "npm", "npx", "pnpm", "tsx"].includes(executable)
  ) {
    return true;
  }
  if (executable === "pnpm" && !excludesPay) {
    if (words.includes("-r") || words.includes("--recursive")) return true;
  }
  const turboIndex = words.indexOf("turbo");
  if (turboIndex >= 0) {
    if (filters.some(isExactPayExclusion)) return false;
    return filters.length === 0 || filters.some(selectorCanIncludePay);
  }
  const changesetIndex = words.findIndex((word) =>
    /^(?:changeset|changesets)$/.test(word),
  );
  return (
    changesetIndex >= 0 &&
    ["publish", "version"].includes(words[changesetIndex + 1])
  );
}

function commandDirectlyExecutesPay(command, cwd = ".") {
  return shellCommandModels(command, { cwd }).some(
    commandModelDirectlyExecutesPay,
  );
}

function modelInvokesScript(command, scriptName) {
  const words = command.words;
  const scriptAfter = (start) =>
    words
      .slice(start)
      .find(
        (word) =>
          !["-w", "--workspace-root"].includes(word) && !word.startsWith("-"),
      );
  if (words[0] === "npm") {
    const runIndex = words.indexOf("run");
    return runIndex >= 0 && scriptAfter(runIndex + 1) === scriptName;
  }
  if (words[0] !== "pnpm") return false;
  const runIndex = words.indexOf("run");
  if (runIndex >= 0) return scriptAfter(runIndex + 1) === scriptName;
  return scriptAfter(1) === scriptName;
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
      if (
        shellCommandModels(command).some((model) =>
          [...aliases].some((alias) => modelInvokesScript(model, alias)),
        )
      ) {
        aliases.add(name);
        changed = true;
      }
    }
  }
  return aliases;
}

function commandExecutesPay(command, aliases, cwd = ".") {
  return shellCommandModels(command, { cwd }).some(
    (model) =>
      commandModelDirectlyExecutesPay(model) ||
      [...aliases].some((alias) => modelInvokesScript(model, alias)),
  );
}

function resolveInput(value, inputs) {
  if (typeof value !== "string") return value;
  const match = /^\$\{\{\s*inputs\.([A-Za-z0-9_-]+)\s*\}\}$/.exec(value);
  return match ? (inputs[match[1]] ?? "") : value;
}

function conditionState(value, inputs = {}) {
  if (
    value === undefined ||
    value === true ||
    value === "true" ||
    value === "${{ true }}"
  ) {
    return "always";
  }
  if (value === false || value === "false" || value === "${{ false }}") {
    return "never";
  }
  if (typeof value !== "string") return "maybe";
  const match =
    /^\$\{\{\s*inputs\.([A-Za-z0-9_-]+)\s*(==|!=)\s*''\s*\}\}$/.exec(value);
  if (!match) return "maybe";
  const empty = String(inputs[match[1]] ?? "") === "";
  return (match[2] === "==" ? empty : !empty) ? "always" : "never";
}

function combineConditions(left, right) {
  if (left === "never" || right === "never") return "never";
  return left === "always" && right === "always" ? "always" : "maybe";
}

function continueState(value) {
  if (value === undefined || value === false || value === "false")
    return "never";
  if (value === true || value === "true") return "always";
  return "maybe";
}

function nodeSelection(step, rootNodeVersion, inputs = {}) {
  if (!step || typeof step !== "object" || typeof step.uses !== "string") {
    return undefined;
  }
  const with_ = step.with && typeof step.with === "object" ? step.with : {};
  if (step.uses === "./.github/actions/js-setup") {
    return {
      selected: resolveInput(with_["node-version"], inputs) || rootNodeVersion,
      source: step.uses,
    };
  }
  if (/^actions\/setup-node@/.test(step.uses)) {
    if (with_["node-version"] !== undefined) {
      return {
        selected: resolveInput(with_["node-version"], inputs),
        source: step.uses,
      };
    }
    if (with_["node-version-file"] === ".nvmrc") {
      return { selected: rootNodeVersion, source: ".nvmrc" };
    }
    return { selected: undefined, source: step.uses };
  }
  return undefined;
}

function actionInputs(action, supplied) {
  const values = {};
  if (action?.inputs && typeof action.inputs === "object") {
    for (const [name, input] of Object.entries(action.inputs)) {
      values[name] =
        input && typeof input === "object" && "default" in input
          ? input.default
          : "";
    }
  }
  if (supplied && typeof supplied === "object") Object.assign(values, supplied);
  return values;
}

function unmodelledUseCanBearPay(step) {
  const source = JSON.stringify(step);
  return /@0xkey-io\/pay(?![\w-])|(?:^|[\s"/])(?:\.\/)?packages\/pay(?:[\s/"}]|$)|(?:^|[\s"/])pay(?:[-_/]|[\s"}]|$)/i.test(
    source,
  );
}

function expandWorkflowSteps({
  steps,
  jobCwd,
  localActions,
  rootNodeVersion,
  parentCondition = "always",
  parentContinue = "never",
  inputs = {},
  actionStack = [],
  workflowName,
  jobName,
}) {
  const expanded = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const condition = combineConditions(
      parentCondition,
      conditionState(step.if, inputs),
    );
    const continued =
      parentContinue === "always" ||
      continueState(step["continue-on-error"]) === "always"
        ? "always"
        : parentContinue === "maybe" ||
            continueState(step["continue-on-error"]) === "maybe"
          ? "maybe"
          : "never";
    const cwd = step["working-directory"] ?? jobCwd;
    const selection = nodeSelection(step, rootNodeVersion, inputs);
    if (selection && step.uses !== "./.github/actions/js-setup") {
      expanded.push({
        type: "setup",
        ...selection,
        condition,
        continued,
      });
      continue;
    }
    if (typeof step.run === "string") {
      expanded.push({
        type: "run",
        command: step.run,
        condition,
        continued,
        cwd,
      });
      continue;
    }
    if (typeof step.uses !== "string") continue;
    if (
      step.uses === "./.github/actions/js-setup" &&
      !localActions.has(step.uses)
    ) {
      expanded.push({
        type: "setup",
        ...selection,
        condition,
        continued,
      });
      continue;
    }
    if (!step.uses.startsWith("./")) {
      if (unmodelledUseCanBearPay(step)) {
        throw new Error(
          `${workflowName} job ${jobName}: unmodelled Pay-bearing action ${step.uses}`,
        );
      }
      continue;
    }
    const actionSource = localActions.get(step.uses);
    if (!actionSource) {
      throw new Error(
        `${workflowName} job ${jobName}: unmodelled Pay-bearing action ${step.uses}`,
      );
    }
    if (actionStack.includes(step.uses)) {
      throw new Error(
        `${workflowName} job ${jobName}: recursive action ${step.uses}`,
      );
    }
    let action;
    try {
      action = parseYaml(actionSource);
    } catch (error) {
      throw new Error(
        `${workflowName} job ${jobName}: cannot parse action ${step.uses}`,
        {
          cause: error,
        },
      );
    }
    if (
      action?.runs?.using !== "composite" ||
      !Array.isArray(action.runs.steps)
    ) {
      throw new Error(
        `${workflowName} job ${jobName}: unmodelled Pay-bearing action ${step.uses}`,
      );
    }
    expanded.push(
      ...expandWorkflowSteps({
        steps: action.runs.steps,
        jobCwd: cwd,
        localActions,
        rootNodeVersion,
        parentCondition: condition,
        parentContinue: continued,
        inputs: actionInputs(action, step.with),
        actionStack: [...actionStack, step.uses],
        workflowName,
        jobName,
      }),
    );
  }
  return expanded;
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
  localActions = new Map(),
  localWorkflows = new Map(),
  workflowStack = [],
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
    if (!job || typeof job !== "object") continue;
    if (conditionState(job.if) === "never") continue;
    if (typeof job.uses === "string") {
      if (job.uses.startsWith("./")) {
        const reusableSource = localWorkflows.get(job.uses);
        if (!reusableSource || workflowStack.includes(job.uses)) {
          throw new Error(
            `${name} job ${jobName}: unmodelled Pay-bearing reusable ${job.uses}`,
          );
        }
        auditWorkflowSource({
          name: job.uses,
          source: reusableSource,
          rootScripts,
          rootNodeVersion,
          localActions,
          localWorkflows,
          workflowStack: [...workflowStack, job.uses],
        });
      } else if (unmodelledUseCanBearPay(job)) {
        throw new Error(
          `${name} job ${jobName}: unmodelled Pay-bearing reusable ${job.uses}`,
        );
      }
      continue;
    }
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const jobCwd = job.defaults?.run?.["working-directory"] ?? ".";
    const expanded = expandWorkflowSteps({
      steps,
      jobCwd,
      localActions,
      rootNodeVersion,
      workflowName: name,
      jobName,
    });
    const payStepIndexes = expanded.flatMap((step, index) =>
      step.type === "run" &&
      step.condition !== "never" &&
      commandExecutesPay(step.command, aliases, step.cwd)
        ? [index]
        : [],
    );
    if (payStepIndexes.length === 0) continue;

    const setups = expanded.flatMap((step, index) =>
      step.type === "setup" && step.condition !== "never"
        ? [{ ...step, index }]
        : [],
    );
    for (const setup of setups) {
      const result = supportedNodeVersion(setup.selected);
      if (!result.supported) {
        throw new Error(`${name} job ${jobName}: ${result.reason}`);
      }
    }
    for (const payStepIndex of payStepIndexes) {
      const activeSetup = setups
        .filter(
          ({ condition, continued, index }) =>
            index < payStepIndex &&
            condition === "always" &&
            continued === "never",
        )
        .at(-1);
      if (!activeSetup) {
        throw new Error(
          `${name} job ${jobName}: Pay executes before a supported Node setup`,
        );
      }
    }
  }
}

function markdownShellSources(source) {
  const blocks = [];
  for (const match of source.matchAll(/```([^\r\n`]*)\r?\n([\s\S]*?)```/g)) {
    const language = match[1].trim().toLowerCase();
    if (!["bash", "console", "sh", "shell", "zsh"].includes(language)) continue;
    blocks.push(
      language === "console" ? match[2].replace(/^\s*\$\s?/gm, "") : match[2],
    );
  }
  return blocks;
}

function workflowCommandModels(name, source) {
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
  const commands = [];
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!job || typeof job !== "object" || !Array.isArray(job.steps)) continue;
    const jobCwd = job.defaults?.run?.["working-directory"] ?? ".";
    for (const [stepIndex, step] of job.steps.entries()) {
      if (!step || typeof step !== "object" || typeof step.run !== "string")
        continue;
      const cwd = step["working-directory"] ?? jobCwd;
      commands.push(
        ...shellCommandModels(step.run, {
          cwd,
          metadata: { jobName, stepId: step.id, stepIndex },
        }),
      );
    }
  }
  return commands;
}

function publishCommandModels({ name, source }) {
  if (
    /\.github\/workflows\/[^/]+\.ya?ml$/.test(name) ||
    /\.ya?ml$/.test(name)
  ) {
    return workflowCommandModels(name, source);
  }
  const shellSources = name.endsWith(".md")
    ? markdownShellSources(source)
    : [source];
  return shellSources.flatMap((shellSource) => shellCommandModels(shellSource));
}

export function auditPublishText({ name, source }) {
  const commands = publishCommandModels({ name, source });
  const operations = commands.flatMap((command) => {
    const operation = publishOperation(command);
    return operation ? [{ command, operation }] : [];
  });
  const dedicated = name.endsWith(".github/workflows/pay-publish.yml");
  if (dedicated) {
    const mutations = operations.filter(({ operation }) => !operation.dryRun);
    const only = mutations[0];
    const checkedPack = commands.some(
      (command) =>
        command.stepId === "pack" &&
        command.jobName === only?.command.jobName &&
        command.stepIndex < only?.command.stepIndex &&
        command.words[0] === "pnpm" &&
        filterValues(command.words).some(isExactPaySelector) &&
        command.words.includes("artifact:check") &&
        hasOption(command.words, "--pack-destination"),
    );
    if (
      mutations.length !== 1 ||
      !only ||
      only.operation.kind !== "npm" ||
      only.operation.target?.replace(/\s+/g, " ") !==
        "${{ steps.pack.outputs.tarball }}" ||
      only.operation.tag !== "next" ||
      !checkedPack
    ) {
      throw new Error(
        `${name}: pay-publish must publish the single checked tarball exactly once with --tag next`,
      );
    }
    return;
  }
  for (const { operation } of operations) {
    if (operation.kind === "changesets") {
      throw new Error(
        `${name}: raw Changesets publish can publish ${PAY_PACKAGE}`,
      );
    }
    if (operation.recursive && !operation.excludesPay) {
      throw new Error(`${name}: recursive publish must exclude ${PAY_PACKAGE}`);
    }
    if (!operation.dryRun && operation.targetsPay) {
      throw new Error(`${name}: direct Pay publish bypasses pay-publish.yml`);
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

async function localActionSources(repositoryRoot) {
  const actionRoot = resolve(repositoryRoot, ".github/actions");
  const sources = new Map();
  for (const entry of await readdir(actionRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const fileName of ["action.yml", "action.yaml"]) {
      try {
        const source = await readFile(
          join(actionRoot, entry.name, fileName),
          "utf8",
        );
        sources.set(`./.github/actions/${entry.name}`, source);
        break;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return sources;
}

export async function auditRepositoryReleaseSafety(repositoryRoot) {
  const [manifestSource, rootNodeVersion, setupSource, localActions] =
    await Promise.all([
      readFile(resolve(repositoryRoot, "package.json"), "utf8"),
      readFile(resolve(repositoryRoot, ".nvmrc"), "utf8"),
      readFile(
        resolve(repositoryRoot, ".github/actions/js-setup/action.yml"),
        "utf8",
      ),
      localActionSources(repositoryRoot),
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
  const workflowEntries = await readdir(workflowRoot, { withFileTypes: true });
  const localWorkflows = new Map();
  for (const entry of workflowEntries) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
    localWorkflows.set(
      `./.github/workflows/${entry.name}`,
      await readFile(join(workflowRoot, entry.name), "utf8"),
    );
  }
  for (const entry of workflowEntries) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
    const name = `.github/workflows/${entry.name}`;
    const source = localWorkflows.get(`./${name}`);
    auditWorkflowSource({
      name,
      source,
      rootScripts,
      rootNodeVersion: rootNodeVersion.trim(),
      localActions,
      localWorkflows,
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
