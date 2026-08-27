# Releasing

This document describes how to publish `@0xkey-io/*` packages from this monorepo to the public npm registry.

## Prerequisites

### 1. npm organization

Use the `@0xkey-io` scope (matches the GitHub org `0xkey-io`).

If your npm user account is `0xkey-io`:

1. Go to [npmjs.com](https://www.npmjs.com) → Account Settings → **Convert to Organization**
2. Add team members who need publish access
3. Confirm the org page exists at `https://www.npmjs.com/org/0xkey-io`

### 2. Automation token for generic packages

1. npmjs.com → Access Tokens → **Generate New Token**
2. Choose **Granular Access Token** or **Automation** (recommended for CI; bypasses 2FA)
3. Scope it to the generic packages that this workflow releases. It must not
   have write permission to `@0xkey-io/pay`.
4. Add the token to GitHub repo secrets as `NPM_TOKEN`

`NPM_TOKEN` is used only by the generic Changesets workflow. Pay publication
uses npm trusted publishing and does not consume this token.

### 3. Pay trusted publisher and GitHub environment

Before any Pay RC publication, an npm organization owner must configure the
trusted publisher for the exact `0xkey-io/sdk-js` repository, workflow filename
`pay-publish.yml`, and GitHub environment `production`. The workflow uses a
GitHub-hosted runner, Node 24.3.0, npm 11.5.1, and GitHub OIDC with
`id-token: write`; it does not use `NPM_TOKEN`.

These external npm/GitHub settings are release prerequisites, not state this
repository can prove. As of this document, they are not claimed to be
configured. The generic `NPM_TOKEN` must additionally be restricted so it
cannot write `@0xkey-io/pay`.

The publish job in `.github/workflows/version-and-publish.yml` uses the `production` environment and requires manual approval before publishing.

## Package scope

The repository has 22 generic source-public packages under `@0xkey-io/*`:

```bash
npm install @0xkey-io/sdk-browser
npm install @0xkey-io/react-wallet-kit
npm install @0xkey-io/core @0xkey-io/viem
```

Pay adds one dedicated public artifact while remaining `private: true` in
source, so the artifact-aware contract guard covers 23 externally public
artifacts in total. Other private packages, including
`@0xkey-io/internal-*`, `@0xkey-io/contract-guard`, and
`@0xkey-io/jest-config`, are not published.

## First release (manual, except Pay)

Recommended for the initial `0.1.0` release of the general SDK packages. Every
recursive command must exclude `@0xkey-io/pay`; Pay has a separate checked
tarball release path described below.

```bash
# Login as a member of the @0xkey-io npm org
npm login --scope=@0xkey-io

# From repo root
pnpm install
pnpm run build-all
pnpm run contract-guard

# Dry-run: verify tarball contents for all public packages except Pay
pnpm --filter '!@0xkey-io/pay' publish -r --dry-run --no-git-checks

# Publish all public packages except Pay
pnpm --filter '!@0xkey-io/pay' publish -r --no-git-checks
```

These commands must never be changed to include Pay. Changesets `ignore` does
not protect a direct recursive pnpm publish.

## Subsequent releases (Changesets + CI)

### Day-to-day development

When a PR changes a publishable package, add a changeset:

```bash
pnpm changeset
```

Commit the generated `.changeset/*.md` file with the PR.

### Release workflow

1. Merge changesets to `main`
2. GitHub Actions → **Version Packages Create Release Branch and Publish**
3. Enable:
   - `enable_release`: true
   - `publish_to_npm`: true (only after tests pass)
4. Approve the `production` environment deployment when prompted

The workflow will:

1. Build and validate pending changesets
2. Run `changeset version` and bump package versions
3. Run integration tests (preprod → prod)
4. Dry-run the generic packages with an explicit Pay exclusion, then invoke the
   guarded generic publisher. The wrapper verifies that the official
   Changesets parser sees no Pay release candidate and that Pay remains private
   in source; it never mutates the Pay manifest.
5. Create a GitHub Release

This general workflow versions and publishes other SDK packages only. It
rejects a changeset naming `@0xkey-io/pay` and cannot publish Pay.

### Pay release candidates

Use **Publish Pay SDK release candidate** (`.github/workflows/pay-publish.yml`)
for a reviewed `@0xkey-io/pay` release candidate. It is manual only and takes
the full merged default-branch `source_sha`, the exact `expected_version`, and
`confirm_publish: true`. Dispatch on the default branch itself, not a tag or
another branch at the same commit. The workflow checks that the SHA is still
the current default-branch head, verifies Pay's package gates, and publishes only the
checked tarball for `@0xkey-io/pay` with npm tag `next` after `production`
approval. It refuses an existing version and keeps npm `latest` at `0.2.0`; do
not use the general Changesets workflow or a manual recursive command for this
release.

Before dependency/build code and again immediately before the sole publication,
the workflow requires exact equality of the full lowercase requested SHA,
actual checkout HEAD, freshly fetched default-branch HEAD, `GITHUB_SHA`, and
`GITHUB_WORKFLOW_SHA`. It also requires the direct `workflow_dispatch` event,
repository `0xkey-io/sdk-js`, server `https://github.com`, the exact default-branch
run ref, and workflow ref
`0xkey-io/sdk-js/.github/workflows/pay-publish.yml@refs/heads/<default_branch>`.
Missing or malformed coordinates, a dirty index/worktree, and unexpected
untracked files stop publication. The final check rereads HEAD, not just diff.

The checkout is selected by the executing workflow SHA, never by candidate
input. Both gates load the same source checker from that workflow's immutable
Git blob with replacement objects disabled, so a changed checkout cannot
substitute the checker. Source-status checks isolate inherited command-scope
and global/system Git config, disable fsmonitor, hooks and external diff/textconv,
and reject local clean/process filters. Checkout-local authentication is retained.
This is a direct, same-repository workflow contract, not reusable-workflow
support; adding `workflow_call` requires a separately reviewed caller/called
identity model.

A rerun retains its original GitHub identity and is allowed only while all these
source checks and the version-absence check still hold. After main advances or
any identity mismatch, start a fresh correctly matched dispatch; never override
GitHub variables to make provenance describe a caller-selected checkout. A final
fetch observes main at that moment and is not atomic with later main movement.
These local guards do not prove an npm publication occurred. Actual npm tarball,
registry and signed provenance evidence, including compatibility with the
eventual verifier policy, remains a separate external artifact gate.

`packages/pay/package.json` is deliberately `private: true`, so npm refuses
publication from the source directory. Its `publishConfig` fixes the public npm
registry, public access, and `next` tag. The artifact checker asserts that
private source contract, builds Pay, changes only the manifest to
`private: false` while `pnpm pack` creates the RC tarball, and restores the
exact original bytes in `finally` before it verifies or emits the tarball. The
packed manifest is then checked as public with the exact package name, version,
repository, registry, access, tag, exports, types, and protocol pins. The
dedicated workflow publishes exactly that emitted tarball once with explicit
`next`, public access, npmjs registry, and provenance options.

A public GA promotion on npm tag `latest` is a separate future gated operation.
No current generic workflow or documented manual command is authorized to
publish Pay GA or change Pay's `latest` tag.

#### Preserve and collect npm publication evidence

The checked tar has exactly three named consumers: context preparation, the
single npm publication, and the post-publication collector. Before the final
metadata/source checks, preparation preserves it byte-for-byte alongside
`source-context.json` in a new runner-temporary directory. The context binds
the original direct `main` dispatch/run/workflow/source and immutable Git tree.
A pinned `actions/upload-artifact` v4.6.2 upload must succeed before publication;
the final GateP source guard remains immediately adjacent to `npm publish`.

After the successful publication/tag poll, the dependency-free collector reads
only the fixed public `@0xkey-io/pay` metadata, tar and advertised attestations
endpoints. It requires the public tar to equal the original checked bytes,
indexes all outer attestations, and retains the unique npm SLSA bundle's exact
raw JSON byte slice (no added newline). Metadata `gitHead` is optional, but
must match when present. A second pinned upload transports the closed six-file
receipt described in [the package owner contract](packages/pay/docs/npm-publication-evidence.md).
Neither an HTTP observation, an Actions artifact digest nor unverified SLSA
fields establish signing identity, trusted time, provenance acceptance or GA.

Both uploads use unique full-source/run/attempt names, no overwrite, required
files and 90-day retention. Runner files and expiring Actions artifacts are
not permanent storage. Before GA, an external retention owner must approve and
perform durable export, access control and retention; security owners must
approve independent verifier/root/signer policy and actual npm compatibility.
No such external approval or execution is claimed by local fixture tests.

If publication succeeds but receipt capture fails, **do not rerun publication**.
Use the currently reviewed collector from a trusted checkout and the separately
retained original context/tar. The manual collector is read-only and does not
require current main to remain at the old publication commit; independent
source reachability and cryptographic verification belong to GateD. Missing
originals block recapture, not permission to rebuild, re-sign or re-tag.

The bounded workflow validator pins complete supporting-step contracts from
reviewed GateP `53050213582d67c96a6510efc45e277d2cbdf8ee` to prevent extra pack,
publish, credential or tar-consumer commands hiding in otherwise unchanged
steps. Pins hash JSON with recursively sorted object keys; executable multiline
strings remain byte-exact. Intentional future step changes require explicit
pin refresh and review. New evidence steps, pack/publish/poll and both source
guards have exact semantic checks; no generic shell parser is introduced.

## Version policy

| Change type            | Semver bump               | Changeset type |
| ---------------------- | ------------------------- | -------------- |
| Bug fix, no API change | patch (`0.1.0` → `0.1.1`) | `patch`        |
| New feature / API      | minor (`0.1.0` → `0.2.0`) | `minor`        |
| Breaking change        | major (`0.x` → `1.0.0`)   | `major`        |

First release uses `0.1.0` to signal that the API is not yet stable. Promote to `1.0.0` when the public API is stable.

## Validation checklist

Before any release:

```bash
pnpm run build-all
pnpm run contract-guard
pnpm --filter '!@0xkey-io/pay' publish -r --dry-run --no-git-checks
```

Optional:

```bash
pnpm run pack-smoke   # verify published tarballs
pnpm run test-all     # unit + integration tests
```
