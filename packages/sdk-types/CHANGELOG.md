# @0xkey-io/sdk-types

## 0.2.0

### Minor Changes

- [#47](https://github.com/0xkey-io/sdk-js/pull/47) [`f089d9f`](https://github.com/0xkey-io/sdk-js/commit/f089d9f58eca9754c4e973953751f4fb7b3e2ef8) Author [@torbensen](https://github.com/torbensen) - Prevent duplicate OTP sends and surface the server's resend cooldown.
  `initOtp` now shares one in-flight request between concurrent calls for the
  same contact and Auth Proxy target. A refused send is raised as
  `ZeroXKeyRateLimitError` with code `OTP_RESEND_COOLDOWN` or
  `OTP_INIT_RATE_LIMITED` and `retryAfterSeconds` taken from `Retry-After`.
  The wallet kit disables OTP entry buttons while a send is in flight, counts
  down before Resend is enabled (60 seconds, or the server's wait), and shows
  the cooldown message.

### Patch Changes

- [#46](https://github.com/0xkey-io/sdk-js/pull/46) [`94137a0`](https://github.com/0xkey-io/sdk-js/commit/94137a059397ae3d70b141173a8d3c844705ac71) Author [@torbensen](https://github.com/torbensen) - Expose the Turnkey-aligned MFA policy, session profile, credential binding, and
  `AUTHENTICATORS_NEEDED` identity contracts across every generated public client.

## 0.1.2

### Patch Changes

- Upgrade `createSubOrganization` request types to the V8 contract, including
  V5 root-user parameters.

## 0.1.1

### Patch Changes

- [#12](https://github.com/0xkey-io/sdk-js/pull/12) [`0c93de2`](https://github.com/0xkey-io/sdk-js/commit/0c93de20446b2ecd456d67f0804a9fdd3feab60c) Author [@torbensen](https://github.com/torbensen) - Add remote attestation verification for enclave boot proofs, independent of app proofs. `@0xkey-io/crypto` gains `verifyBootProof` (attestation chain + `user_data` binding + PCR comparison + quorum multi-sig verification against a pinned `manifestSet` trust anchor) along with borsh decoders for QOS manifest/manifest-envelope types (`decodeVersionedManifest`, `decodeVersionedManifestEnvelope`) and the production quorum trust anchor (`PRODUCTION_QUORUM_MANIFEST_SET`). `@0xkey-io/core` adds `fetchLatestBootProof` / `verifyLatestBootProof` client methods that fetch an app's live boot proof from the Coordinator and verify it end-to-end, letting callers confirm that the pivot binary running in a live enclave matches a manifest approved by 0xkey's quorum. `@0xkey-io/sdk-types` gains the corresponding `FETCH_LATEST_BOOT_PROOF_ERROR` / `VERIFY_LATEST_BOOT_PROOF_ERROR` error codes.

## 0.1.0

Initial release.
