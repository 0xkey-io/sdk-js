# @0xkey-io/http

## 0.2.1

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

## 0.2.0

### Minor Changes

- [#25](https://github.com/0xkey-io/sdk-js/pull/25) [`7a09cd9`](https://github.com/0xkey-io/sdk-js/commit/7a09cd93c3dba20ac01e551196605e359dcaf20e) Author [@torbensen](https://github.com/torbensen) - Use the proof-aware signup V2 endpoint for Email OTP registration. Expose
  structured rate-limit errors and safely retry signed requests according to the
  server's Retry-After contract.

### Patch Changes

- [#57](https://github.com/0xkey-io/sdk-js/pull/57) [`9a9008c`](https://github.com/0xkey-io/sdk-js/commit/9a9008cd5926266e51e24eb53b29b2844282a224) Author [@torbensen](https://github.com/torbensen) - Use the canonical "0xkey" brand in user-visible strings. New passkeys added
  without a name are called `0xkey Passkey-<timestamp>` (existing passkeys keep
  their names), request errors read `0xkey error <code>: …`, and SDK warnings
  say "0xkey SDK". Public identifiers such as `ZeroXKeyError` and
  `ZeroXKeyProvider` are unchanged.

- [#46](https://github.com/0xkey-io/sdk-js/pull/46) [`94137a0`](https://github.com/0xkey-io/sdk-js/commit/94137a059397ae3d70b141173a8d3c844705ac71) Author [@torbensen](https://github.com/torbensen) - Expose the Turnkey-aligned MFA policy, session profile, credential binding, and
  `AUTHENTICATORS_NEEDED` identity contracts across every generated public client.
- Updated dependencies []:
  - @0xkey-io/api-key-stamper@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/api-key-stamper@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/api-key-stamper@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/encoding@0.1.1
  - @0xkey-io/api-key-stamper@0.1.1

## 0.1.0

Initial release.
