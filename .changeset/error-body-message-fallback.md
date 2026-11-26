---
"@0xkey-io/http": patch
"@0xkey-io/core": patch
"@0xkey-io/sdk-browser": patch
"@0xkey-io/sdk-server": patch
---

`ZeroXKeyRequestError` 现在能读 Auth Proxy 的错误体 `{"error":"…","code":"OIDC_…"}`：
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
