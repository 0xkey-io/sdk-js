---
"@0xkey-io/core": patch
"@0xkey-io/react-native-wallet-kit": patch
"@0xkey-io/react-wallet-kit": patch
---

Security: stop defaulting to hosts on `0xkey.com`, a domain 0xkey does not
own. The fallbacks now point at the 0xkey.io services; nothing else changes.

- `@0xkey-io/core`: without an `apiBaseUrl`, the client sends requests to
  `https://api.0xkey.io` (was `https://api.0xkey.com`).
- `@0xkey-io/react-wallet-kit`: without `importIframeUrl` / `exportIframeUrl`,
  wallet import and export load `https://import.0xkey.io` and
  `https://export.0xkey.io` (were `import.0xkey.com` and `export.0xkey.com`).
- `@0xkey-io/react-native-wallet-kit`: without `auth.oauth.redirectUri` or an
  Auth Proxy `oauthRedirectUrl`, Google, Apple and Facebook sign-in uses
  `https://oauth-origin.0xkey.io` and `https://oauth-redirect.0xkey.io/`
  (were `oauth-origin.0xkey.com` and `oauth-redirect.0xkey.com`). The provider
  callback to register becomes `https://oauth-redirect.0xkey.io/?scheme=<appScheme>`.

Apps that already configure these values explicitly are unaffected.
