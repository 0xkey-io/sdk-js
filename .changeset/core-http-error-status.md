---
"@0xkey-io/core": patch
---

非 2xx 响应的错误现在都带 HTTP 状态码。响应体是 JSON gRPC status 时，
`ZeroXKeyRequestError` 新增 `status` 和 `retryAfter`；响应体不是 JSON
（例如网关返回的纯文本 401）时抛出新的 `ZeroXKeyHttpError`，带 `status`、
`statusText`、`retryAfter` 和 `bodySummary`（折叠空白后最多 200 个字符）。
`ZeroXKeyHttpError` 的 `message` 仍是原来的 `"<status> <statusText>"`，
按消息匹配错误的调用方不受影响。
