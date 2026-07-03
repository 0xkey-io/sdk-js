# @0xkey-io/crypto

## 0.3.0

### Minor Changes

- [#12](https://github.com/0xkey-io/sdk-js/pull/12) [`0c93de2`](https://github.com/0xkey-io/sdk-js/commit/0c93de20446b2ecd456d67f0804a9fdd3feab60c) Author [@torbensen](https://github.com/torbensen) - Add remote attestation verification for enclave boot proofs, independent of app proofs. `@0xkey-io/crypto` gains `verifyBootProof` (attestation chain + `user_data` binding + PCR comparison + quorum multi-sig verification against a pinned `manifestSet` trust anchor) along with borsh decoders for QOS manifest/manifest-envelope types (`decodeVersionedManifest`, `decodeVersionedManifestEnvelope`) and the production quorum trust anchor (`PRODUCTION_QUORUM_MANIFEST_SET`). `@0xkey-io/core` adds `fetchLatestBootProof` / `verifyLatestBootProof` client methods that fetch an app's live boot proof from the Coordinator and verify it end-to-end, letting callers confirm that the pivot binary running in a live enclave matches a manifest approved by 0xkey's quorum. `@0xkey-io/sdk-types` gains the corresponding `FETCH_LATEST_BOOT_PROOF_ERROR` / `VERIFY_LATEST_BOOT_PROOF_ERROR` error codes.

- [#14](https://github.com/0xkey-io/sdk-js/pull/14) [`2ccadfa`](https://github.com/0xkey-io/sdk-js/commit/2ccadfa470cfd966e89e52999107a9ffd3a3e29d) Author [@torbensen](https://github.com/torbensen) - `verify(appProof, bootProof)` now delegates its boot-proof checks to `verifyBootProof`, closing a security gap: it previously only checked the AWS attestation chain and `user_data`/manifest binding, but never checked PCR values or quorum multi-sig approvals — so a manifest that was never approved by 0xkey's quorum (or that declared different PCRs than what's actually running) would still pass. `verify()` now accepts an optional `anchor` parameter (defaults to `PRODUCTION_QUORUM_MANIFEST_SET`, same as `verifyBootProof`), and `@0xkey-io/core`'s `verifyAppProofs` accepts and forwards the same `anchor` option.

### Patch Changes

- [#13](https://github.com/0xkey-io/sdk-js/pull/13) [`e538f3a`](https://github.com/0xkey-io/sdk-js/commit/e538f3a7ce746f81ce53940d6a2f609ae33df277) Author [@torbensen](https://github.com/torbensen) - Fix `cbor-js` interop under Node's native ESM loader: `verifyBootProof`/`verifyAppProof` previously threw `CBOR.decode is not a function` when the published `.mjs` build was imported directly in Node (bundler-based consumers were unaffected).

- [#14](https://github.com/0xkey-io/sdk-js/pull/14) [`2ccadfa`](https://github.com/0xkey-io/sdk-js/commit/2ccadfa470cfd966e89e52999107a9ffd3a3e29d) Author [@torbensen](https://github.com/torbensen) - Add `STAGING_QUORUM_MANIFEST_SET`, a public trust anchor for verifying boot proofs from 0xkey's `staging-default` enclave environment (analogous to the existing `PRODUCTION_QUORUM_MANIFEST_SET`, but pinned to staging's own, separate quorum ceremony). Pass it explicitly to `verifyBootProof`/`verify` when verifying non-production enclaves.

- Updated dependencies [[`0c93de2`](https://github.com/0xkey-io/sdk-js/commit/0c93de20446b2ecd456d67f0804a9fdd3feab60c)]:
  - @0xkey-io/sdk-types@0.1.1

## 0.2.0

### Minor Changes

- add webhook Ed25519 signature verification helpers (`verifyWebhook`, `verifyWebhookFromJWKS`)

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
