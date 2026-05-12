# Releasing

This document describes how to publish `@0xkey-io/*` packages from this monorepo to the public npm registry.

## Prerequisites

### 1. npm organization

Use the `@0xkey-io` scope (matches the GitHub org `0xkey-io`).

If your npm user account is `0xkey-io`:

1. Go to [npmjs.com](https://www.npmjs.com) → Account Settings → **Convert to Organization**
2. Add team members who need publish access
3. Confirm the org page exists at `https://www.npmjs.com/org/0xkey-io`

### 2. Automation token for CI

1. npmjs.com → Access Tokens → **Generate New Token**
2. Choose **Granular Access Token** or **Automation** (recommended for CI; bypasses 2FA)
3. Scope: `@0xkey-io/*`, permission: **Read and write**
4. Add the token to GitHub repo secrets as `NPM_TOKEN`

### 3. GitHub environment

The publish job in `.github/workflows/version-and-publish.yml` uses the `production` environment and requires manual approval before publishing.

## Package scope

All 22 public packages publish under `@0xkey-io/*`:

```bash
npm install @0xkey-io/sdk-browser
npm install @0xkey-io/react-wallet-kit
npm install @0xkey-io/core @0xkey-io/viem
```

Internal packages (`@0xkey-io/internal-*`, `@0xkey-io/contract-guard`, `@0xkey-io/jest-config`) are `private: true` and are not published.

## First release (manual)

Recommended for the initial `0.1.0` release:

```bash
# Login as a member of the @0xkey-io npm org
npm login --scope=@0xkey-io

# From repo root
pnpm install
pnpm run build-all
pnpm run contract-guard

# Dry-run: verify tarball contents for all packages
pnpm publish -r --dry-run --no-git-checks

# Publish all public packages
pnpm publish -r --no-git-checks
```

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
4. Publish to npm with `pnpm publish -r`
5. Create a GitHub Release

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
pnpm publish -r --dry-run --no-git-checks
```

Optional:

```bash
pnpm run pack-smoke   # verify published tarballs
pnpm run test-all     # unit + integration tests
```
