import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";
import { checkPayPublishWorkflow } from "../../../.github/scripts/check-pay-publish-workflow.mjs";

const root = new URL("../../../", import.meta.url);
const workflowSource = await readFile(
  new URL(".github/workflows/pay-publish.yml", root),
  "utf8",
);
const workflow = parse(workflowSource);
const initialName = "Verify immutable default-branch source";
const finalName = "Reconfirm immutable default-branch source";
const guardPath = ".github/scripts/check-pay-publish-source.sh";
const steps = workflow.jobs.publish.steps;
const initialScript = steps.find(({ name }) => name === initialName).run;
const finalScript = steps.find(({ name }) => name === finalName).run;

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "pay-publish-source-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const origin = join(directory, "origin");
  const checkout = join(directory, "checkout");
  // Do not inherit Git configuration, credential helpers, hooks or signing.
  // All fetches/clones are real Git operations over local file transport only.
  const env = {
    PATH: process.env.PATH,
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "commit.gpgSign",
    GIT_CONFIG_VALUE_1: "false",
    GIT_CONFIG_KEY_2: "credential.helper",
    GIT_CONFIG_VALUE_2: "",
    GIT_AUTHOR_NAME: "Synthetic release test",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Synthetic release test",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  function git(cwd, ...args) {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git(directory, "init", "--initial-branch=main", "--template=", origin);
  await writeFile(join(origin, "tracked"), "original\n");
  await writeFile(
    join(origin, ".gitattributes"),
    "tracked filter=synthetic diff=synthetic\n",
  );
  const guard = await readFile(new URL(guardPath, root), "utf8");
  await mkdir(join(origin, ".github/scripts"), { recursive: true });
  await writeFile(join(origin, guardPath), guard);
  git(origin, "add", ".");
  git(origin, "commit", "-m", "synthetic A");
  const a = git(origin, "rev-parse", "HEAD");
  git(origin, "commit", "--allow-empty", "-m", "synthetic B");
  const b = git(origin, "rev-parse", "HEAD");
  git(directory, "clone", "--no-local", "--template=", origin, checkout);
  const context = {
    ...env,
    PAY_PUBLISH_SOURCE_SHA: b,
    PAY_PUBLISH_DEFAULT_BRANCH: "main",
    GITHUB_SHA: b,
    GITHUB_WORKFLOW_SHA: b,
    GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF:
      "0xkey-io/sdk-js/.github/workflows/pay-publish.yml@refs/heads/main",
    GITHUB_REPOSITORY: "0xkey-io/sdk-js",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_RUN_ATTEMPT: "1",
  };
  return {
    a,
    b,
    origin,
    checkout,
    context,
    git: (cwd, ...args) => git(cwd, ...args),
    run(script, changes = {}) {
      const selected = { ...context, ...changes };
      for (const key of Object.keys(selected))
        if (selected[key] === undefined) delete selected[key];
      return spawnSync("bash", ["--noprofile", "--norc", "-c", script], {
        cwd: checkout,
        env: selected,
        encoding: "utf8",
      });
    },
  };
}

function accepted(result) {
  assert.equal(
    result.status,
    0,
    `unexpected rejection:\n${result.stdout}${result.stderr}`,
  );
}
function rejected(result) {
  assert.notEqual(result.status, null, "source guard must run to completion");
  assert.notEqual(
    result.status,
    0,
    `unsafe source accepted:\n${result.stdout}${result.stderr}`,
  );
}

for (const [phase, script] of [
  ["initial", initialScript],
  ["final", finalScript],
]) {
  test(`${phase} source checkpoint binds actual GitHub identity and Git state`, async (t) => {
    const f = await fixture(t);
    await t.test("matching direct default-branch run", () =>
      accepted(f.run(script)),
    );
    await t.test("valid rerun keeps the same source", () =>
      accepted(f.run(script, { GITHUB_RUN_ATTEMPT: "2" })),
    );
    const changes = [
      ["stale run", { GITHUB_SHA: f.a }],
      ["stale workflow", { GITHUB_WORKFLOW_SHA: f.a }],
      ["stale run and workflow", { GITHUB_SHA: f.a, GITHUB_WORKFLOW_SHA: f.a }],
      [
        "stale rerun",
        { GITHUB_SHA: f.a, GITHUB_WORKFLOW_SHA: f.a, GITHUB_RUN_ATTEMPT: "2" },
      ],
      ["stale requested source", { PAY_PUBLISH_SOURCE_SHA: f.a }],
      ["same-SHA branch", { GITHUB_REF: "refs/heads/release" }],
      ["same-SHA tag", { GITHUB_REF: "refs/tags/v1" }],
      [
        "wrong workflow path",
        {
          GITHUB_WORKFLOW_REF:
            "0xkey-io/sdk-js/.github/workflows/other.yml@refs/heads/main",
        },
      ],
      [
        "workflow tag",
        {
          GITHUB_WORKFLOW_REF:
            "0xkey-io/sdk-js/.github/workflows/pay-publish.yml@refs/tags/v1",
        },
      ],
      [
        "workflow repository",
        {
          GITHUB_WORKFLOW_REF:
            "other/sdk-js/.github/workflows/pay-publish.yml@refs/heads/main",
        },
      ],
      ["wrong repository", { GITHUB_REPOSITORY: "other/sdk-js" }],
      ["repository case", { GITHUB_REPOSITORY: "0xkey-io/SDK-JS" }],
      ["wrong server", { GITHUB_SERVER_URL: "https://github.example.com" }],
      ["server trailing slash", { GITHUB_SERVER_URL: "https://github.com/" }],
      ["wrong event", { GITHUB_EVENT_NAME: "push" }],
      ["reusable event", { GITHUB_EVENT_NAME: "workflow_call" }],
      [
        "invalid default branch",
        { PAY_PUBLISH_DEFAULT_BRANCH: "main:refs/heads/other" },
      ],
    ];
    for (const key of [
      "PAY_PUBLISH_SOURCE_SHA",
      "GITHUB_SHA",
      "GITHUB_WORKFLOW_SHA",
    ]) {
      for (const value of [
        f.b.toUpperCase(),
        f.b.slice(0, 12),
        `${f.b}\n`,
        "z".repeat(40),
      ]) {
        changes.push([
          `malformed ${key}: ${JSON.stringify(value)}`,
          { [key]: value },
        ]);
      }
    }
    for (const key of Object.keys(f.context).filter(
      (key) =>
        key.startsWith("PAY_PUBLISH_") ||
        (key.startsWith("GITHUB_") && key !== "GITHUB_RUN_ATTEMPT"),
    )) {
      changes.push(
        [`missing ${key}`, { [key]: undefined }],
        [`empty ${key}`, { [key]: "" }],
      );
    }
    for (const [name, values] of changes)
      await t.test(name, () => rejected(f.run(script, values)));
    await t.test("clean wrong checkout", () => {
      f.git(f.checkout, "checkout", "--detach", f.a);
      rejected(f.run(script));
      f.git(f.checkout, "checkout", "--detach", f.b);
    });
    await t.test("dirty tracked worktree", async () => {
      await writeFile(join(f.checkout, "tracked"), "modified\n");
      rejected(f.run(script));
    });
    await t.test("dirty index", () => {
      f.git(f.checkout, "add", "tracked");
      rejected(f.run(script));
      f.git(
        f.checkout,
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "tracked",
      );
    });
    await t.test("untracked file", async () => {
      await writeFile(join(f.checkout, "unexpected"), "untracked\n");
      rejected(f.run(script));
      await rm(join(f.checkout, "unexpected"));
    });
    await t.test("remote advances before checkpoint", () => {
      f.git(f.origin, "commit", "--allow-empty", "-m", "synthetic C");
      rejected(f.run(script));
    });
  });
}

test("final checkpoint observes movement since the successful initial gate", async (t) => {
  const f = await fixture(t);
  accepted(f.run(initialScript));
  f.git(f.checkout, "checkout", "--detach", f.a);
  rejected(f.run(finalScript));
  f.git(f.checkout, "checkout", "--detach", f.b);
  accepted(f.run(finalScript));
  f.git(
    f.origin,
    "commit",
    "--allow-empty",
    "-m",
    "main advances after initial",
  );
  rejected(f.run(finalScript));
});

test("missing immutable workflow blob or vanished default branch fails closed", async (t) => {
  const f = await fixture(t);
  for (const script of [initialScript, finalScript]) {
    rejected(f.run(script, { GITHUB_WORKFLOW_SHA: "f".repeat(40) }));
  }
  f.git(f.origin, "update-ref", "-d", "refs/heads/main");
  // The local origin/main still names B; a failed fetch must not use it.
  for (const script of [initialScript, finalScript]) rejected(f.run(script));
});

test("trusted workflow blob cannot be replaced by candidate checkout or Git replace refs", async (t) => {
  const f = await fixture(t);
  accepted(f.run(initialScript));
  await writeFile(join(f.checkout, guardPath), "exit 0\n");
  f.git(f.checkout, "add", guardPath);
  f.git(f.checkout, "commit", "-m", "synthetic malicious guard");
  const replacement = f.git(f.checkout, "rev-parse", "HEAD");
  rejected(f.run(finalScript));
  f.git(f.checkout, "checkout", "--detach", f.b);
  f.git(f.checkout, "replace", f.b, replacement);
  for (const script of [initialScript, finalScript])
    rejected(f.run(script, { GITHUB_SHA: f.a }));
  f.git(f.checkout, "replace", "--delete", f.b);
  accepted(f.run(finalScript));
});

test("source status never invokes configured clean filters, fsmonitor or external diff", async (t) => {
  const f = await fixture(t);
  const marker = join(f.checkout, "executed-untrusted-command");
  const command = `touch '${marker}'`;
  for (const config of [
    "core.fsmonitor",
    "diff.external",
    "diff.synthetic.textconv",
  ])
    f.git(f.checkout, "config", config, command);
  accepted(f.run(initialScript));
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  f.git(f.checkout, "config", "filter.synthetic.clean", command);
  for (const script of [initialScript, finalScript]) rejected(f.run(script));
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  f.git(f.checkout, "config", "--unset", "filter.synthetic.clean");
  const includedConfig = join(f.checkout, ".git", "included-filter-config");
  f.git(
    f.checkout,
    "config",
    "--file",
    includedConfig,
    "filter.synthetic.clean",
    command,
  );
  f.git(f.checkout, "config", "include.path", includedConfig);
  for (const script of [initialScript, finalScript]) rejected(f.run(script));
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("bounded workflow enforces both executable source gates and their order", async (t) => {
  assert.doesNotThrow(() => checkPayPublishWorkflow(workflowSource));
  for (const name of [initialName, finalName]) {
    for (const [label, mutate] of [
      ["deleted", (all, gate) => all.splice(all.indexOf(gate), 1)],
      [
        "no-op",
        (_all, gate) => {
          gate.run = "true";
        },
      ],
      [
        "comment-only",
        (_all, gate) => {
          gate.run = `# ${gate.run.replaceAll("\n", "\n# ")}\ntrue`;
        },
      ],
      [
        "disabled",
        (_all, gate) => {
          gate.if = false;
        },
      ],
      [
        "disabled expression",
        (_all, gate) => {
          gate.if = "${{ false }}";
        },
      ],
      [
        "failure ignored",
        (_all, gate) => {
          gate["continue-on-error"] = true;
        },
      ],
      [
        "wrong directory",
        (_all, gate) => {
          gate["working-directory"] = "packages/pay";
        },
      ],
      [
        "no pipefail",
        (_all, gate) => {
          gate.run = gate.run.replace("set -euo pipefail", "set -eu");
        },
      ],
      [
        "replace objects enabled",
        (_all, gate) => {
          gate.run = gate.run.replace("--no-replace-objects ", "");
        },
      ],
      [
        "after install",
        (all, gate) => {
          all.splice(all.indexOf(gate), 1);
          all.splice(
            all.findIndex((step) => step.name === "Install dependencies") + 1,
            0,
            gate,
          );
        },
      ],
      [
        "after publish",
        (all, gate) => {
          all.splice(all.indexOf(gate), 1);
          all.splice(
            all.findIndex(
              (step) => step.name === "Publish only @0xkey-io/pay to npm next",
            ) + 1,
            0,
            gate,
          );
        },
      ],
    ])
      await t.test(`${name}: ${label}`, () => {
        const candidate = parse(workflowSource);
        const all = candidate.jobs.publish.steps;
        mutate(
          all,
          all.find((step) => step.name === name),
        );
        assert.throws(() => checkPayPublishWorkflow(stringify(candidate)));
      });
  }
  await t.test("candidate input cannot select executable checkout", () => {
    const candidate = parse(workflowSource);
    candidate.jobs.publish.steps[0].with.ref = "${{ inputs.source_sha }}";
    assert.throws(() => checkPayPublishWorkflow(stringify(candidate)));
  });
});
