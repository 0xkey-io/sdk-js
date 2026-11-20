---
"@0xkey-io/crypto": minor
---

**Breaking**：`encryptOnRampSecret(secret, onRampEncryptionPublicKey)` 的第二个
参数改为必填，缺失或为空时抛出明确错误。同时删除导出常量
`PRODUCTION_ON_RAMP_CREDENTIALS_ENCRYPTION_PUBLIC_KEY`。

原来的默认值是从上游继承的、另一家服务商的生产 on-ramp 加密公钥。0xkey 没有发布
自己的 on-ramp 加密公钥，用那把公钥加密的凭证 0xkey 无法解密。依赖默认值的调用方
现在需要显式传入目标公钥（十六进制压缩 P-256 公钥）。
