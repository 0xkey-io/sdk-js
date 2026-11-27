# @0xkey-io/react-wallet-kit

## 0.4.1

### Patch Changes

- Updated dependencies [[`caf6478`](https://github.com/0xkey-io/sdk-js/commit/caf6478c237dcebae650ff85de2a7241227c600e)]:
  - @0xkey-io/core@0.3.1

## 0.4.0

### Minor Changes

- [#47](https://github.com/0xkey-io/sdk-js/pull/47) [`f089d9f`](https://github.com/0xkey-io/sdk-js/commit/f089d9f58eca9754c4e973953751f4fb7b3e2ef8) Author [@torbensen](https://github.com/torbensen) - Prevent duplicate OTP sends and surface the server's resend cooldown.
  `initOtp` now shares one in-flight request between concurrent calls for the
  same contact and Auth Proxy target. A refused send is raised as
  `ZeroXKeyRateLimitError` with code `OTP_RESEND_COOLDOWN` or
  `OTP_INIT_RATE_LIMITED` and `retryAfterSeconds` taken from `Retry-After`.
  The wallet kit disables OTP entry buttons while a send is in flight, counts
  down before Resend is enabled (60 seconds, or the server's wait), and shows
  the cooldown message.

- [#14](https://github.com/0xkey-io/sdk-js/pull/14) [`131ac3c`](https://github.com/0xkey-io/sdk-js/commit/131ac3cf2c8657dd320de872e4ea8a750b98d912) Author [@torbensen](https://github.com/torbensen) - Add `handleVerifyEnclave` + `VerifyEnclavePage`: a standalone, visual "verify enclave identity" flow using `verifyLatestBootProof`, independent of App Proofs. Unlike `handleVerifyAppProofs` (which requires an App Proof to already exist), this can be triggered any time to show end users that the live enclave running a given app (e.g. "signer") matches a manifest approved by 0xkey's quorum multi-sig — including a visible failure state (previous verification UI silently closed on error).

### Patch Changes

- [#51](https://github.com/0xkey-io/sdk-js/pull/51) [`21d3f61`](https://github.com/0xkey-io/sdk-js/commit/21d3f615fcb3ab5e9e745bb321e880323d0456d6) Author [@torbensen](https://github.com/torbensen) - `handleAddPasskey` no longer leaves an unhandled promise rejection when adding
  the passkey fails (for example, a name with characters outside the allowed
  set). The error still rejects to the caller, and the success page is shown
  only after the passkey is added.

- [#57](https://github.com/0xkey-io/sdk-js/pull/57) [`9a9008c`](https://github.com/0xkey-io/sdk-js/commit/9a9008cd5926266e51e24eb53b29b2844282a224) Author [@torbensen](https://github.com/torbensen) - Use the canonical "0xkey" brand in user-visible strings. New passkeys added
  without a name are called `0xkey Passkey-<timestamp>` (existing passkeys keep
  their names), request errors read `0xkey error <code>: …`, and SDK warnings
  say "0xkey SDK". Public identifiers such as `ZeroXKeyError` and
  `ZeroXKeyProvider` are unchanged.

- [#64](https://github.com/0xkey-io/sdk-js/pull/64) [`85e36d1`](https://github.com/0xkey-io/sdk-js/commit/85e36d1ca3b325a58b2a40ae44a929cd8985ad97) Author [@torbensen](https://github.com/torbensen) - Correct the documented default of `addEthereumPrefix` for `signMessage` and
  `handleSignMessage`. Runtime behavior is unchanged: when the option is omitted,
  embedded Ethereum accounts sign the raw message without the EIP-191 prefix, so
  the signature does not verify with `personal_sign` or viem/ethers
  `verifyMessage`. The JSDoc previously said the prefix was added by default for
  Ethereum. Pass `addEthereumPrefix: true` when you need an EIP-191 signature;
  connected Ethereum wallets still require `true`.

- [#47](https://github.com/0xkey-io/sdk-js/pull/47) [`f089d9f`](https://github.com/0xkey-io/sdk-js/commit/f089d9f58eca9754c4e973953751f4fb7b3e2ef8) Author [@torbensen](https://github.com/torbensen) - 明确 TypeScript 消费者支持下限：TypeScript 5.4 及以上，并使用
  `moduleResolution: "bundler"`（`module` 为 `esnext` 或 `preserve`）。依赖 `ox`
  本身要求 TypeScript 5.4+。`node16`／`nodenext` 解析不在支持范围内：严格模式且
  `skipLibCheck: false` 时，Core 与 React Wallet Kit 会因 `ox` → `abitype` 及 Core →
  `@wallet-standard/base` 的 CommonJS 声明引用 ESM 声明而报 `TS1479`，SDK 不提供双声明构建来规避。
  `encoding`、`crypto`、`api-key-stamper`、`attested-stamper` 目前仍能在 Node16 下通过类型检查，
  仓库继续检查，但不作为兼容承诺。本次不改运行时代码、依赖版本或锁文件。
- Updated dependencies [[`9a9008c`](https://github.com/0xkey-io/sdk-js/commit/9a9008cd5926266e51e24eb53b29b2844282a224), [`6d71a11`](https://github.com/0xkey-io/sdk-js/commit/6d71a117c8b717ad023b8ed805b6ca099fa7373c), [`4155c24`](https://github.com/0xkey-io/sdk-js/commit/4155c249c1c012e5e98ab54d837d0163598007c3), [`e21d0f6`](https://github.com/0xkey-io/sdk-js/commit/e21d0f6e5a1f6b092b60486877fed01b2c9a731e), [`924b7b4`](https://github.com/0xkey-io/sdk-js/commit/924b7b41835ec623cfd8a20c0744b343277bcf8a), [`f089d9f`](https://github.com/0xkey-io/sdk-js/commit/f089d9f58eca9754c4e973953751f4fb7b3e2ef8), [`cf5b8fd`](https://github.com/0xkey-io/sdk-js/commit/cf5b8fd0d72b9a32d15519fc40d0e7fb5e993938), [`7a09cd9`](https://github.com/0xkey-io/sdk-js/commit/7a09cd93c3dba20ac01e551196605e359dcaf20e), [`85e36d1`](https://github.com/0xkey-io/sdk-js/commit/85e36d1ca3b325a58b2a40ae44a929cd8985ad97), [`81a7f91`](https://github.com/0xkey-io/sdk-js/commit/81a7f91c6b9dbcdf3e98667a6b2aadc01a85032e), [`94137a0`](https://github.com/0xkey-io/sdk-js/commit/94137a059397ae3d70b141173a8d3c844705ac71), [`f089d9f`](https://github.com/0xkey-io/sdk-js/commit/f089d9f58eca9754c4e973953751f4fb7b3e2ef8), [`497a0cc`](https://github.com/0xkey-io/sdk-js/commit/497a0cc151b803b166eb443625682a1a4216e779)]:
  - @0xkey-io/core@0.3.0
  - @0xkey-io/crypto@0.4.0
  - @0xkey-io/sdk-types@0.2.0

## 0.3.1

> Published to npm on 2026-10-15 from the security release line `release/security/0xkey-com-hosts-rwk-0.3.1/38703859678` (git tag `@0xkey-io/react-wallet-kit@0.3.1`, commit `0bd4e2b`), not from `main`. Security advisories: [GHSA-x4cf-59wm-72gv](https://github.com/0xkey-io/sdk-js/security/advisories/GHSA-x4cf-59wm-72gv), [GHSA-883c-fqwg-phgv](https://github.com/0xkey-io/sdk-js/security/advisories/GHSA-883c-fqwg-phgv). `main` already contains the same host fix; this entry registers the published version so the next release from `main` versions past it instead of colliding with it.
>
> The same fix was also published for the 0.2 line as `@0xkey-io/react-wallet-kit@0.2.1` (npm dist-tag `legacy-0.2`, commit `417832d`).

### Patch Changes

- [`7a2df40`](https://github.com/0xkey-io/sdk-js/commit/7a2df4010a1a20a535eb6ecbb3dc0b4efcc502b2) Author [@torbensen](https://github.com/torbensen) - Security: stop defaulting to hosts on a third-party domain that 0xkey does not
  own. Without `importIframeUrl` / `exportIframeUrl`, wallet import and export
  load `https://import.0xkey.io` and `https://export.0xkey.io`, and the package
  depends on `@0xkey-io/core@0.2.1`, whose API fallback is
  `https://api.0xkey.io`. Nothing else changes; apps that configure these values
  explicitly are unaffected.

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
