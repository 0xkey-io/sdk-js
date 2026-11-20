---
"@0xkey-io/react-native-wallet-kit": minor
---

本版本精确锁定 `@0xkey-io/core` 和 `@0xkey-io/crypto` 的新 minor 版本，因此按 minor
发布，而不是 patch；用 `^0.1.x` 的应用不会在重新安装时被动拿到下面的行为变化。

- 邮箱和短信 OTP 登录（`completeOtp`）改为先走 Attested StampLogin；服务端不支持时，
  按 core 的窄条件回退到 Auth Proxy `otp_login_v2`。回退要求配置 `authProxyConfigId`，
  得到的 Session 时长取 Auth Proxy 配置。
- 依赖的 `@0xkey-io/crypto` 中，`encryptOnRampSecret` 必须显式传入加密公钥。
