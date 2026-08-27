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
`confirm_publish: true`. The workflow checks that the SHA is still the current
default-branch head, verifies Pay's package gates, and publishes only the
checked tarball for `@0xkey-io/pay` with npm tag `next` after `production`
approval. It refuses an existing version and keeps npm `latest` at `0.2.0`; do
not use the general Changesets workflow or a manual recursive command for this
release.

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
