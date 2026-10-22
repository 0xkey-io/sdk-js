# @0xkey-io/react-native-wallet-kit

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
