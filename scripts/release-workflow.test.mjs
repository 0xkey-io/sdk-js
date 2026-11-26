// Contract for the generic release workflow (version-and-publish.yml).
// Run with: node --test scripts/release-workflow.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(
  await readFile(
    new URL("../.github/workflows/version-and-publish.yml", import.meta.url),
    "utf8",
  ),
);
const jobs = workflow.jobs;
const inputs = workflow.on.workflow_dispatch.inputs;

function step(job, name) {
  const matches = jobs[job].steps.filter((item) => item.name === name);
  assert.equal(matches.length, 1, `${job} must have one "${name}" step`);
  return matches[0];
}

function runs(job) {
  return jobs[job].steps.map((item) => String(item.run ?? "")).join("\n");
}

test("integration tests are an explicit opt-in that defaults to skipped", () => {
  assert.equal(inputs.skip_integration_tests, undefined);
  assert.equal(inputs.run_integration_tests.type, "boolean");
  assert.equal(inputs.run_integration_tests.default, false);
  for (const job of ["test-pre-prod", "test-prod"]) {
    assert.match(jobs[job].if, /inputs\.run_integration_tests/);
  }
});

test("a run without integration tests records what replaced them", () => {
  const summary = step("publish", "Record release verification");
  assert.match(summary.run, /GITHUB_STEP_SUMMARY/);
  assert.match(summary.run, /unit tests/i);
  assert.match(summary.run, /prod smoke/i);
  const release = step("prepare-release", "Create GitHub Release");
  assert.match(release.with.body, /unit tests/i);
  assert.match(release.with.body, /prod smoke/i);
});

test("the generic publish path publishes with npm provenance", () => {
  assert.equal(jobs.publish.permissions["id-token"], "write");
  assert.match(
    step("publish", "Publish to NPM (dry run)").run,
    /pnpm .*publish .*--provenance/,
  );
  // changeset publish has no --provenance flag; pnpm hands this to npm.
  assert.equal(
    step("publish", "Publish packages to NPM").env.NPM_CONFIG_PROVENANCE,
    "true",
  );
});

test("the generic publish path publishes the built, pack-smoked files without rebuilding", () => {
  // changeset publish publishes packages concurrently, and each package's
  // prepublishOnly runs clean and build. That rebuild must not run: it can
  // delete a dependency's dist/ while another package type-checks against it.
  for (const name of ["Publish to NPM (dry run)", "Publish packages to NPM"]) {
    assert.equal(
      step("publish", name).env.NPM_CONFIG_IGNORE_SCRIPTS,
      "true",
      `${name} must skip lifecycle scripts`,
    );
  }
  const names = jobs.publish.steps.map((item) => item.name);
  const index = (name) => {
    const found = names.indexOf(name);
    assert.notEqual(found, -1, `publish job needs a "${name}" step`);
    return found;
  };
  assert.ok(index("Build all packages") < index("Pack smoke"));
  assert.ok(index("Pack smoke") < index("Publish to NPM (dry run)"));
  assert.ok(
    index("Publish to NPM (dry run)") < index("Publish packages to NPM"),
  );
  // Nothing between the check and the publish may build again.
  const between = jobs.publish.steps
    .slice(index("Pack smoke") + 1, index("Publish packages to NPM"))
    .map((item) => String(item.run ?? ""))
    .join("\n");
  assert.doesNotMatch(between, /build|rollup|tsc|clean/);
});

test("published versions return to the default branch only through a PR", () => {
  for (const name of Object.keys(jobs)) {
    const source = runs(name);
    assert.doesNotMatch(source, /merge --ff-only/, `${name} fast-forwards`);
    assert.doesNotMatch(
      source,
      /git push [^\n]*HEAD:\$\{\{ github\.event\.repository\.default_branch \}\}/,
      `${name} pushes to the default branch`,
    );
    assert.doesNotMatch(
      source,
      /git push [^\n]*\bmain\b/,
      `${name} pushes main`,
    );
  }
  assert.match(runs("sync-main"), /gh pr create/);
  assert.match(jobs["sync-main"].if, /needs\.publish\.result == 'success'/);
});

test("repository metadata is checked before anything is versioned", () => {
  const names = jobs.build.steps.map((item) => item.name);
  const check = names.indexOf("Require repository metadata for provenance");
  assert.ok(check !== -1, "build checks repository metadata");
  assert.ok(check < names.indexOf("Build"));
  assert.match(
    step("build", "Require repository metadata for provenance").run,
    /release-guard\.mjs assert-repository/,
  );
});

test("a single-package republish is separate from the generic release", () => {
  assert.equal(inputs.republish_package.type, "string");
  assert.equal(inputs.republish_package.default, "");
  assert.match(jobs.build.if, /inputs\.republish_package == ''/);

  const republish = jobs.republish;
  assert.equal(republish.needs, undefined);
  assert.match(republish.if, /inputs\.publish_to_npm/);
  assert.match(republish.if, /inputs\.republish_package != ''/);
  assert.equal(republish.environment, "production");
  assert.equal(republish.permissions["id-token"], "write");
  assert.equal(republish.env.PACKAGE, "${{ inputs.republish_package }}");

  const source = runs("republish");
  assert.doesNotMatch(source, /changeset (version|publish)/);
  assert.doesNotMatch(source, /\$\{\{ inputs\.republish_package \}\}/);
  assert.match(
    step("republish", "Check the republish target").run,
    /assert-republishable "\$PACKAGE"/,
  );
  assert.match(
    step("republish", "Pack and check the tarball").run,
    /pack-republish "\$PACKAGE"/,
  );
  const publish = step("republish", "Publish the checked tarball to NPM");
  assert.match(publish.run, /npm publish "\$TARBALL" --provenance/);
  assert.equal(publish.env.TARBALL, "${{ steps.pack.outputs.tarball }}");
});

test("release tags are pushed after publish and never named after a branch", () => {
  const push = step("publish", "Push release tags");
  assert.match(push.run, /git tag --points-at HEAD/);
  // Also after a partial publish, so published versions keep their tags.
  assert.match(push.if, /always\(\) && steps\.publish\.outcome != 'skipped'/);
  assert.match(push.run, /refs\/tags\//);
  assert.equal(jobs.publish.permissions.contents, "write");
  assert.ok(jobs.publish.outputs.release_tags);

  const release = jobs["prepare-release"];
  assert.match(release.if, /needs\.publish\.result == 'success'/);
  assert.match(
    release.strategy.matrix.tag,
    /fromJSON\(needs\.publish\.outputs\.release_tags\)/,
  );
  const create = step("prepare-release", "Create GitHub Release");
  assert.equal(create.with.tag_name, "${{ matrix.tag }}");
  assert.doesNotMatch(JSON.stringify(release), /github\.ref_name/);
  assert.match(
    step("prepare-release", "Refuse a tag that is not a package release").run,
    /@0xkey-io\//,
  );
});
