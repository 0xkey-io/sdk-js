# @0xkey-io/crypto

## 0.1.1

### Patch Changes

- fix: remove unpublished internal packages from runtime dependencies

  `@0xkey-io/internal-crypto-core` and `@0xkey-io/internal-codec` were listed
  in `dependencies` despite being bundled into the dist output at build time.
  This caused `npm install` to fail with 404 since these private packages are
  not published to the registry. Moved them to `devDependencies` so the
  published manifest only contains packages that consumers can actually resolve.

- Updated dependencies []:
  - @0xkey-io/encoding@0.1.1

## 0.1.0

Initial release.
