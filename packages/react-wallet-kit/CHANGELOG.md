# @0xkey-io/react-wallet-kit

## 0.3.0

### Minor Changes

- [#4](https://github.com/0xkey-io/sdk-js/pull/4) [`30c62f3`](https://github.com/0xkey-io/sdk-js/commit/30c62f366b8cf82b1525cc7b794e3f8b74a26a90) Author [@torbensen](https://github.com/torbensen) - Add a headless fiat on-ramp module with MoonPay URL signing.

  `@0xkey-io/core` gains `buildMoonPayOnRampUrl` / `appendMoonPaySignature`,
  `initOnRampFlow` (returning a structured `OnRampFlowResult` with status, signed
  URL, provider and sandbox mode), `pollOnRampTransactionStatus` (timeout,
  max-consecutive-error and `AbortSignal` handling plus an `onStatusUpdate`
  per-poll callback), typed `OnRampError` / `OnRampErrorCode`, and provider
  capability guards (MoonPay-only runtime in phase 1; Coinbase config-only).

  `@0xkey-io/react-wallet-kit` `handleOnRamp` now consumes the core helpers:
  explicit required `sandboxMode`, structured result return, `openMode`
  strategies, `onStatusChange` wiring, and early unsupported-provider rejection.

- [#14](https://github.com/0xkey-io/sdk-js/pull/14) [`2ccadfa`](https://github.com/0xkey-io/sdk-js/commit/2ccadfa470cfd966e89e52999107a9ffd3a3e29d) Author [@torbensen](https://github.com/torbensen) - Add `handleVerifyEnclave` + `VerifyEnclavePage`: a standalone, visual "verify enclave identity" flow using `verifyLatestBootProof`, independent of App Proofs. Unlike `handleVerifyAppProofs` (which requires an App Proof to already exist), this can be triggered any time to show end users that the live enclave running a given app (e.g. "signer") matches a manifest approved by 0xkey's quorum multi-sig — including a visible failure state (previous verification UI silently closed on error).

### Patch Changes

- Updated dependencies [[`0c93de2`](https://github.com/0xkey-io/sdk-js/commit/0c93de20446b2ecd456d67f0804a9fdd3feab60c), [`e538f3a`](https://github.com/0xkey-io/sdk-js/commit/e538f3a7ce746f81ce53940d6a2f609ae33df277), [`30c62f3`](https://github.com/0xkey-io/sdk-js/commit/30c62f366b8cf82b1525cc7b794e3f8b74a26a90), [`2ccadfa`](https://github.com/0xkey-io/sdk-js/commit/2ccadfa470cfd966e89e52999107a9ffd3a3e29d), [`2ccadfa`](https://github.com/0xkey-io/sdk-js/commit/2ccadfa470cfd966e89e52999107a9ffd3a3e29d)]:
  - @0xkey-io/crypto@0.3.0
  - @0xkey-io/core@0.2.0
  - @0xkey-io/sdk-types@0.1.1

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/core@0.1.1

## 0.1.0

Initial release.
