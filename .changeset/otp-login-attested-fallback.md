---
"@0xkey-io/core": minor
---

`loginWithOtp`（以及调用它的 `completeOtp`、`signUpWithOtp`）在服务端不支持
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
