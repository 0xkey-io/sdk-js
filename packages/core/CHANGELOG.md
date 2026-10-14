# @0xkey-io/core

## 0.2.0

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

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/crypto@0.2.0
  - @0xkey-io/api-key-stamper@0.1.2
  - @0xkey-io/http@0.1.2
  - @0xkey-io/react-native-passkey-stamper@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/crypto@0.1.1
  - @0xkey-io/encoding@0.1.1
  - @0xkey-io/api-key-stamper@0.1.1
  - @0xkey-io/http@0.1.1
  - @0xkey-io/react-native-passkey-stamper@0.1.1

## 0.1.0

Initial release.
