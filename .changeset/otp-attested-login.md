---
"@0xkey-io/core": minor
---

`loginWithOtp` 使用 Verification Token 绑定的本地密钥，通过 Attested StampLogin
建立并保存 Session。支持 Session TTL、Session Profile、组织和撤销旧会话参数；
保留底层 `proxyOtpLoginV2` 的 A→B 签名能力。旧 `publicKey` 参数暂时兼容同一把密钥，
若与 Token 密钥不同则明确报错。这是 0xkey 的过渡扩展，并非与上游类型逐字相同。
现有 `signUpWithOtp` 和 `completeOtp` 组合流程也传递 Token 密钥与已验证组织。
