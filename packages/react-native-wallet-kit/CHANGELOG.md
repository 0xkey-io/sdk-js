# @0xkey-io/react-native-wallet-kit

## 0.2.1

### Patch Changes

- Updated dependencies [[`caf6478`](https://github.com/0xkey-io/sdk-js/commit/caf6478c237dcebae650ff85de2a7241227c600e), [`bed9806`](https://github.com/0xkey-io/sdk-js/commit/bed9806331d1db91bdfe58f8d211d6515a60143e)]:
  - @0xkey-io/core@0.3.1
  - @0xkey-io/react-native-passkey-stamper@0.1.5

## 0.2.0

### Minor Changes

- [#66](https://github.com/0xkey-io/sdk-js/pull/66) [`6c6edc0`](https://github.com/0xkey-io/sdk-js/commit/6c6edc02ec6df5f829f6467c3535eff9025864ff) Author [@torbensen](https://github.com/torbensen) - 本版本精确锁定 `@0xkey-io/core` 和 `@0xkey-io/crypto` 的新 minor 版本，因此按 minor
  发布，而不是 patch；用 `^0.1.x` 的应用不会在重新安装时被动拿到下面的行为变化。
  - 邮箱和短信 OTP 登录（`completeOtp`）改为先走 Attested StampLogin；服务端不支持时，
    按 core 的窄条件回退到 Auth Proxy `otp_login_v2`。回退要求配置 `authProxyConfigId`，
    得到的 Session 时长取 Auth Proxy 配置。
  - 依赖的 `@0xkey-io/crypto` 中，`encryptOnRampSecret` 必须显式传入加密公钥。

### Patch Changes

- [#57](https://github.com/0xkey-io/sdk-js/pull/57) [`9a9008c`](https://github.com/0xkey-io/sdk-js/commit/9a9008cd5926266e51e24eb53b29b2844282a224) Author [@torbensen](https://github.com/torbensen) - Use the canonical "0xkey" brand in user-visible strings. New passkeys added
  without a name are called `0xkey Passkey-<timestamp>` (existing passkeys keep
  their names), request errors read `0xkey error <code>: …`, and SDK warnings
  say "0xkey SDK". Public identifiers such as `ZeroXKeyError` and
  `ZeroXKeyProvider` are unchanged.

- [#58](https://github.com/0xkey-io/sdk-js/pull/58) [`9b4118a`](https://github.com/0xkey-io/sdk-js/commit/9b4118a2f86b2a014d79477ec8ee59061449a7fb) Author [@torbensen](https://github.com/torbensen) - Export `permitsCaptchaNavigation`, the navigation guard for the Captcha
  challenge WebView. Apps that render the controlled challenge page pass it to
  `onShouldStartLoadWithRequest`: it allows only the exact challenge page and
  Cloudflare subframes, and rejects every other navigation.

- [#52](https://github.com/0xkey-io/sdk-js/pull/52) [`1cbccc0`](https://github.com/0xkey-io/sdk-js/commit/1cbccc0a1c5e89dc699690d52ccb927d7f89c6cb) Author [@torbensen](https://github.com/torbensen) - Add `auth.oauth.originUri` so Google, Apple and Facebook sign-in can use a
  hosted OAuth origin page other than `https://oauth-origin.0xkey.io`, for
  example `https://oauth-origin.staging.0xkey.io/` together with a staging
  `redirectUri`. The value must be `https://` without a query or fragment and is
  bound to the OAuth transaction like the redirect URI.

- [#53](https://github.com/0xkey-io/sdk-js/pull/53) [`cc2ba7f`](https://github.com/0xkey-io/sdk-js/commit/cc2ba7fbbe64dbc09d4e9e7442cac6cc2a72c2d3) Author [@torbensen](https://github.com/torbensen) - Add `signerEnvironment` (`"prod"` default, or `"staging"`) to the provider
  config. `exportWallet`, `exportWalletAccount`, `exportPrivateKey`,
  `importWallet` and `importPrivateKey` verify the enclave bundle against the
  pinned Signer key of that environment. Previously they always used the
  production key, so every export and import against staging failed with
  "expected signer key ... does not match signer key from bundle".

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
  - @0xkey-io/react-native-passkey-stamper@0.1.4

## 0.1.4

> Published to npm on 2026-10-15 from the security release line `release/security/0xkey-com-hosts-core-0.2.1-rnwk-0.1.4/38617449082` (git tag `@0xkey-io/react-native-wallet-kit@0.1.4`, commit `417832d`), not from `main`. Security advisories: [GHSA-fpfh-w5pv-pf22](https://github.com/0xkey-io/sdk-js/security/advisories/GHSA-fpfh-w5pv-pf22), [GHSA-883c-fqwg-phgv](https://github.com/0xkey-io/sdk-js/security/advisories/GHSA-883c-fqwg-phgv). `main` already contains the same host fix; this entry registers the published version so the next release from `main` versions past it instead of colliding with it.

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

- Updated dependencies [[`1bfbca4`](https://github.com/0xkey-io/sdk-js/commit/1bfbca4795877b73ffb25ee4c5fd0f634475a2e3)]:
  - @0xkey-io/core@0.2.1

## 0.1.3

### Patch Changes

- Updated dependencies [[`0c93de2`](https://github.com/0xkey-io/sdk-js/commit/0c93de20446b2ecd456d67f0804a9fdd3feab60c), [`e538f3a`](https://github.com/0xkey-io/sdk-js/commit/e538f3a7ce746f81ce53940d6a2f609ae33df277), [`30c62f3`](https://github.com/0xkey-io/sdk-js/commit/30c62f366b8cf82b1525cc7b794e3f8b74a26a90), [`2ccadfa`](https://github.com/0xkey-io/sdk-js/commit/2ccadfa470cfd966e89e52999107a9ffd3a3e29d), [`2ccadfa`](https://github.com/0xkey-io/sdk-js/commit/2ccadfa470cfd966e89e52999107a9ffd3a3e29d)]:
  - @0xkey-io/crypto@0.3.0
  - @0xkey-io/core@0.2.0
  - @0xkey-io/sdk-types@0.1.1
  - @0xkey-io/react-native-passkey-stamper@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/crypto@0.2.0
  - @0xkey-io/core@0.1.2
  - @0xkey-io/react-native-passkey-stamper@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/crypto@0.1.1
  - @0xkey-io/encoding@0.1.1
  - @0xkey-io/core@0.1.1
  - @0xkey-io/react-native-passkey-stamper@0.1.1

## 0.1.0

Initial release.
