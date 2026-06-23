---
"@0xkey-io/core": minor
"@0xkey-io/react-wallet-kit": minor
---

Add a headless fiat on-ramp module with MoonPay URL signing.

`@0xkey-io/core` gains `buildMoonPayOnRampUrl` / `appendMoonPaySignature`,
`initOnRampFlow` (returning a structured `OnRampFlowResult` with status, signed
URL, provider and sandbox mode), `pollOnRampTransactionStatus` (timeout,
max-consecutive-error and `AbortSignal` handling plus an `onStatusUpdate`
per-poll callback), typed `OnRampError` / `OnRampErrorCode`, and provider
capability guards (MoonPay-only runtime in phase 1; Coinbase config-only).

`@0xkey-io/react-wallet-kit` `handleOnRamp` now consumes the core helpers:
explicit required `sandboxMode`, structured result return, `openMode`
strategies, `onStatusChange` wiring, and early unsupported-provider rejection.
