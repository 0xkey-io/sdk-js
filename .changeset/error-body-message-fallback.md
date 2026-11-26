---
"@0xkey-io/http": patch
"@0xkey-io/core": patch
"@0xkey-io/sdk-browser": patch
"@0xkey-io/sdk-server": patch
---

`ZeroXKeyRequestError` 现在能读 Auth Proxy 的错误体 `{"error":"…","code":"OIDC_…"}`：
`message` 缺失或为空时，错误文本回退取 `error` 字段，消息形如
`0xkey error OIDC_TOKEN_EXPIRED: <error 文本>`，不再出现 `undefined`。字符串形式的
`code` 保存到新增的 `reason` 属性，`code` 始终是 number（数字字符串按数字解析；
没有数字 code 时为 gRPC `UNKNOWN`，即 2）。`GrpcStatus` 的字段改为可选并新增 `error`。
带数字 `code` 和非空 `message` 的 gRPC status 错误行为不变。
