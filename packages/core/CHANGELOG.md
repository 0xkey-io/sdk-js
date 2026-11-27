# @0xkey-io/core

## 0.3.1

### Patch Changes

- [#75](https://github.com/0xkey-io/sdk-js/pull/75) [`caf6478`](https://github.com/0xkey-io/sdk-js/commit/caf6478c237dcebae650ff85de2a7241227c600e) Author [@torbensen](https://github.com/torbensen) - `ZeroXKeyRequestError` 现在能读 Auth Proxy 的错误体 `{"error":"…","code":"OIDC_…"}`：
  `message` 缺失或为空时，错误文本回退取 `error` 字段，消息形如
  `0xkey error OIDC_TOKEN_EXPIRED: <error 文本>`，不再出现 `undefined`。非数字的字符串
  `code` 保存到新增的 `errorCode` 属性（与 sdk-swift、sdk-kotlin 同名），`code` 始终是
  number：数字 `code` 原样保留，纯数字字符串（如 `"16"`）按数字解析，`+7`、`-7` 这类
  带符号的字符串不算数字，进入 `errorCode`。没有数字 `code` 时，`@0xkey-io/core` 按 HTTP
  状态推导（401 为 16、403 为 7、429 为 8，与 Swift、Kotlin 同一张表）；`http`、`sdk-browser`、
  `sdk-server` 的错误类拿不到 HTTP 状态，取 gRPC `UNKNOWN`（2）。`GrpcStatus` 的字段改为可选并
  新增 `error`。带数字 `code` 和非空 `message` 的 gRPC status 错误行为不变。

  迁移提示：以前字符串 `code` 会被原样塞进 `code`，运行时读 `error.code` 能拿到
  `"OIDC_…"`（类型却声明为 number）。依赖这一行为的调用方请改读 `error.errorCode`。

- Updated dependencies [[`caf6478`](https://github.com/0xkey-io/sdk-js/commit/caf6478c237dcebae650ff85de2a7241227c600e), [`bed9806`](https://github.com/0xkey-io/sdk-js/commit/bed9806331d1db91bdfe58f8d211d6515a60143e)]:
  - @0xkey-io/http@0.2.1
  - @0xkey-io/react-native-passkey-stamper@0.1.5

## 0.3.0

### Minor Changes

- [#41](https://github.com/0xkey-io/sdk-js/pull/41) [`924b7b4`](https://github.com/0xkey-io/sdk-js/commit/924b7b41835ec623cfd8a20c0744b343277bcf8a) Author [@torbensen](https://github.com/torbensen) - `loginWithOtp` 使用 Verification Token 绑定的本地密钥，通过 Attested StampLogin
  建立并保存 Session。支持 Session TTL、Session Profile、组织和撤销旧会话参数；
  保留底层 `proxyOtpLoginV2` 的 A→B 签名能力。旧 `publicKey` 参数暂时兼容同一把密钥，
  若与 Token 密钥不同则明确报错。这是 0xkey 的过渡扩展，并非与上游类型逐字相同。
  现有 `signUpWithOtp` 和 `completeOtp` 组合流程也传递 Token 密钥与已验证组织。
  省略 `organizationId` 的独立登录会使用原始 Verification Token 查询已验证联系方式绑定，
  再将返回的组织显式交给 StampLogin；这是保留 0xkey 旧高层默认行为的兼容扩展。

- [#47](https://github.com/0xkey-io/sdk-js/pull/47) [`f089d9f`](https://github.com/0xkey-io/sdk-js/commit/f089d9f58eca9754c4e973953751f4fb7b3e2ef8) Author [@torbensen](https://github.com/torbensen) - Prevent duplicate OTP sends and surface the server's resend cooldown.
  `initOtp` now shares one in-flight request between concurrent calls for the
  same contact and Auth Proxy target. A refused send is raised as
  `ZeroXKeyRateLimitError` with code `OTP_RESEND_COOLDOWN` or
  `OTP_INIT_RATE_LIMITED` and `retryAfterSeconds` taken from `Retry-After`.
  The wallet kit disables OTP entry buttons while a send is in flight, counts
  down before Resend is enabled (60 seconds, or the server's wait), and shows
  the cooldown message.

- [#66](https://github.com/0xkey-io/sdk-js/pull/66) [`cf5b8fd`](https://github.com/0xkey-io/sdk-js/commit/cf5b8fd0d72b9a32d15519fc40d0e7fb5e993938) Author [@torbensen](https://github.com/torbensen) - `loginWithOtp`（以及调用它的 `completeOtp`、`signUpWithOtp`）在服务端不支持
  Attested StampLogin 时，改走 Auth Proxy `otp_login_v2` 完成登录：用 Verification
  Token 绑定的本地密钥，对 `getClientSignatureMessageForLogin` 生成的
  `USAGE_TYPE_LOGIN` 消息做原始 P-256 签名。

  只在以下情况回退：
  - HTTP 401，且响应体不是 JSON（不认识 `X-Stamp-Attested` 的网关）；
  - HTTP 503，或错误 reason 为 `ATTESTED_STAMP_NOT_ENABLED`；
  - HTTP 404、501。

  以下情况不回退，原错误照常抛出：HTTP 403（无论 reason 是什么）、任何
  `ATTESTED_LOGIN_*` reason、其余 `ATTESTED_STAMP_*` reason、JSON 格式的 401、其他状态码
  和网络错误。这样服务端因 MFA 等策略拒绝的单因子登录不会被回退绕过。

  回退还要求客户端配置了 Auth Proxy（`authProxyUrl` 和 `authProxyConfigId`），并且
  没有传 `sessionProfileId`。回退得到的 Session 时长取 Auth Proxy 配置，不取
  `expirationSeconds`。

- [#25](https://github.com/0xkey-io/sdk-js/pull/25) [`7a09cd9`](https://github.com/0xkey-io/sdk-js/commit/7a09cd93c3dba20ac01e551196605e359dcaf20e) Author [@torbensen](https://github.com/torbensen) - Use the proof-aware signup V2 endpoint for Email OTP registration. Expose
  structured rate-limit errors and safely retry signed requests according to the
  server's Retry-After contract.

### Patch Changes

- [#57](https://github.com/0xkey-io/sdk-js/pull/57) [`9a9008c`](https://github.com/0xkey-io/sdk-js/commit/9a9008cd5926266e51e24eb53b29b2844282a224) Author [@torbensen](https://github.com/torbensen) - Use the canonical "0xkey" brand in user-visible strings. New passkeys added
  without a name are called `0xkey Passkey-<timestamp>` (existing passkeys keep
  their names), request errors read `0xkey error <code>: …`, and SDK warnings
  say "0xkey SDK". Public identifiers such as `ZeroXKeyError` and
  `ZeroXKeyProvider` are unchanged.

- [#66](https://github.com/0xkey-io/sdk-js/pull/66) [`6d71a11`](https://github.com/0xkey-io/sdk-js/commit/6d71a117c8b717ad023b8ed805b6ca099fa7373c) Author [@torbensen](https://github.com/torbensen) - 非 2xx 响应的错误现在都带 HTTP 状态码。响应体是 JSON gRPC status 时，
  `ZeroXKeyRequestError` 新增 `status` 和 `retryAfter`；响应体不是 JSON
  （例如网关返回的纯文本 401）时抛出新的 `ZeroXKeyHttpError`，带 `status`、
  `statusText`、`retryAfter` 和 `bodySummary`（折叠空白后最多 200 个字符）。
  `ZeroXKeyHttpError` 的 `message` 仍是原来的 `"<status> <statusText>"`，
  按消息匹配错误的调用方不受影响。

- [#24](https://github.com/0xkey-io/sdk-js/pull/24) [`4155c24`](https://github.com/0xkey-io/sdk-js/commit/4155c249c1c012e5e98ab54d837d0163598007c3) Author [@torbensen](https://github.com/torbensen) - Upgrade browser/core `createSubOrganization` clients to the current V8 activity
  contract and defensively flatten newer versioned result keys from completed
  activities. The server SDK and shared types were released separately as the
  tenant hotfix.

- [#64](https://github.com/0xkey-io/sdk-js/pull/64) [`85e36d1`](https://github.com/0xkey-io/sdk-js/commit/85e36d1ca3b325a58b2a40ae44a929cd8985ad97) Author [@torbensen](https://github.com/torbensen) - Correct the documented default of `addEthereumPrefix` for `signMessage` and
  `handleSignMessage`. Runtime behavior is unchanged: when the option is omitted,
  embedded Ethereum accounts sign the raw message without the EIP-191 prefix, so
  the signature does not verify with `personal_sign` or viem/ethers
  `verifyMessage`. The JSDoc previously said the prefix was added by default for
  Ethereum. Pass `addEthereumPrefix: true` when you need an EIP-191 signature;
  connected Ethereum wallets still require `true`.

- [#46](https://github.com/0xkey-io/sdk-js/pull/46) [`94137a0`](https://github.com/0xkey-io/sdk-js/commit/94137a059397ae3d70b141173a8d3c844705ac71) Author [@torbensen](https://github.com/torbensen) - Expose the Turnkey-aligned MFA policy, session profile, credential binding, and
  `AUTHENTICATORS_NEEDED` identity contracts across every generated public client.

- [#47](https://github.com/0xkey-io/sdk-js/pull/47) [`f089d9f`](https://github.com/0xkey-io/sdk-js/commit/f089d9f58eca9754c4e973953751f4fb7b3e2ef8) Author [@torbensen](https://github.com/torbensen) - 明确 TypeScript 消费者支持下限：TypeScript 5.4 及以上，并使用
  `moduleResolution: "bundler"`（`module` 为 `esnext` 或 `preserve`）。依赖 `ox`
  本身要求 TypeScript 5.4+。`node16`／`nodenext` 解析不在支持范围内：严格模式且
  `skipLibCheck: false` 时，Core 与 React Wallet Kit 会因 `ox` → `abitype` 及 Core →
  `@wallet-standard/base` 的 CommonJS 声明引用 ESM 声明而报 `TS1479`，SDK 不提供双声明构建来规避。
  `encoding`、`crypto`、`api-key-stamper`、`attested-stamper` 目前仍能在 Node16 下通过类型检查，
  仓库继续检查，但不作为兼容承诺。本次不改运行时代码、依赖版本或锁文件。

- [#14](https://github.com/0xkey-io/sdk-js/pull/14) [`497a0cc`](https://github.com/0xkey-io/sdk-js/commit/497a0cc151b803b166eb443625682a1a4216e779) Author [@torbensen](https://github.com/torbensen) - `verify(appProof, bootProof)` now delegates its boot-proof checks to `verifyBootProof`, closing a security gap: it previously only checked the AWS attestation chain and `user_data`/manifest binding, but never checked PCR values or quorum multi-sig approvals — so a manifest that was never approved by 0xkey's quorum (or that declared different PCRs than what's actually running) would still pass. `verify()` now accepts an optional `anchor` parameter (defaults to `PRODUCTION_QUORUM_MANIFEST_SET`, same as `verifyBootProof`), and `@0xkey-io/core`'s `verifyAppProofs` accepts and forwards the same `anchor` option.

- Updated dependencies [[`9a9008c`](https://github.com/0xkey-io/sdk-js/commit/9a9008cd5926266e51e24eb53b29b2844282a224), [`e21d0f6`](https://github.com/0xkey-io/sdk-js/commit/e21d0f6e5a1f6b092b60486877fed01b2c9a731e), [`f089d9f`](https://github.com/0xkey-io/sdk-js/commit/f089d9f58eca9754c4e973953751f4fb7b3e2ef8), [`7a09cd9`](https://github.com/0xkey-io/sdk-js/commit/7a09cd93c3dba20ac01e551196605e359dcaf20e), [`81a7f91`](https://github.com/0xkey-io/sdk-js/commit/81a7f91c6b9dbcdf3e98667a6b2aadc01a85032e), [`94137a0`](https://github.com/0xkey-io/sdk-js/commit/94137a059397ae3d70b141173a8d3c844705ac71), [`497a0cc`](https://github.com/0xkey-io/sdk-js/commit/497a0cc151b803b166eb443625682a1a4216e779)]:
  - @0xkey-io/http@0.2.0
  - @0xkey-io/crypto@0.4.0
  - @0xkey-io/sdk-types@0.2.0
  - @0xkey-io/react-native-passkey-stamper@0.1.4
  - @0xkey-io/api-key-stamper@0.1.4
  - @0xkey-io/attested-stamper@0.1.1

## 0.2.1

> Published to npm on 2026-10-15 from the security release line `release/security/0xkey-com-hosts-core-0.2.1-rnwk-0.1.4/38617449082` (git tag `@0xkey-io/core@0.2.1`, commit `417832d`), not from `main`. Security advisories: [GHSA-883c-fqwg-phgv](https://github.com/0xkey-io/sdk-js/security/advisories/GHSA-883c-fqwg-phgv). `main` already contains the same host fix; this entry registers the published version so the next release from `main` versions past it instead of colliding with it.

### Patch Changes

- [`1bfbca4`](https://github.com/0xkey-io/sdk-js/commit/1bfbca4795877b73ffb25ee4c5fd0f634475a2e3) Author [@torbensen](https://github.com/torbensen) - Security: stop defaulting to hosts on a third-party domain that 0xkey does not
  own. The fallbacks now point at the 0xkey.io services; nothing else changes.
  - `@0xkey-io/core`: without an `apiBaseUrl`, the client sends requests to
    `https://api.0xkey.io`.
  - `@0xkey-io/react-wallet-kit`: without `importIframeUrl` / `exportIframeUrl`,
    wallet import and export load `https://import.0xkey.io` and
    `https://export.0xkey.io`.
  - `@0xkey-io/react-native-wallet-kit`: without `auth.oauth.redirectUri` or an
    Auth Proxy `oauthRedirectUrl`, Google, Apple and Facebook sign-in uses
    `https://oauth-origin.0xkey.io` and `https://oauth-redirect.0xkey.io/`. The
    provider callback to register becomes
    `https://oauth-redirect.0xkey.io/?scheme=<appScheme>`.

  Apps that already configure these values explicitly are unaffected.

## 0.2.0

### Minor Changes

- [#12](https://github.com/0xkey-io/sdk-js/pull/12) [`0c93de2`](https://github.com/0xkey-io/sdk-js/commit/0c93de20446b2ecd456d67f0804a9fdd3feab60c) Author [@torbensen](https://github.com/torbensen) - Add remote attestation verification for enclave boot proofs, independent of app proofs. `@0xkey-io/crypto` gains `verifyBootProof` (attestation chain + `user_data` binding + PCR comparison + quorum multi-sig verification against a pinned `manifestSet` trust anchor) along with borsh decoders for QOS manifest/manifest-envelope types (`decodeVersionedManifest`, `decodeVersionedManifestEnvelope`) and the production quorum trust anchor (`PRODUCTION_QUORUM_MANIFEST_SET`). `@0xkey-io/core` adds `fetchLatestBootProof` / `verifyLatestBootProof` client methods that fetch an app's live boot proof from the Coordinator and verify it end-to-end, letting callers confirm that the pivot binary running in a live enclave matches a manifest approved by 0xkey's quorum. `@0xkey-io/sdk-types` gains the corresponding `FETCH_LATEST_BOOT_PROOF_ERROR` / `VERIFY_LATEST_BOOT_PROOF_ERROR` error codes.

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

### Patch Changes

- [#14](https://github.com/0xkey-io/sdk-js/pull/14) [`2ccadfa`](https://github.com/0xkey-io/sdk-js/commit/2ccadfa470cfd966e89e52999107a9ffd3a3e29d) Author [@torbensen](https://github.com/torbensen) - `verify(appProof, bootProof)` now delegates its boot-proof checks to `verifyBootProof`, closing a security gap: it previously only checked the AWS attestation chain and `user_data`/manifest binding, but never checked PCR values or quorum multi-sig approvals — so a manifest that was never approved by 0xkey's quorum (or that declared different PCRs than what's actually running) would still pass. `verify()` now accepts an optional `anchor` parameter (defaults to `PRODUCTION_QUORUM_MANIFEST_SET`, same as `verifyBootProof`), and `@0xkey-io/core`'s `verifyAppProofs` accepts and forwards the same `anchor` option.

- Updated dependencies [[`0c93de2`](https://github.com/0xkey-io/sdk-js/commit/0c93de20446b2ecd456d67f0804a9fdd3feab60c), [`e538f3a`](https://github.com/0xkey-io/sdk-js/commit/e538f3a7ce746f81ce53940d6a2f609ae33df277), [`2ccadfa`](https://github.com/0xkey-io/sdk-js/commit/2ccadfa470cfd966e89e52999107a9ffd3a3e29d), [`2ccadfa`](https://github.com/0xkey-io/sdk-js/commit/2ccadfa470cfd966e89e52999107a9ffd3a3e29d)]:
  - @0xkey-io/crypto@0.3.0
  - @0xkey-io/sdk-types@0.1.1
  - @0xkey-io/api-key-stamper@0.1.3
  - @0xkey-io/http@0.1.3
  - @0xkey-io/react-native-passkey-stamper@0.1.3

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
