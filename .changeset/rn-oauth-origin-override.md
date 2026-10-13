---
"@0xkey-io/react-native-wallet-kit": patch
---

Add `auth.oauth.originUri` so Google, Apple and Facebook sign-in can use a
hosted OAuth origin page other than `https://oauth-origin.0xkey.io`, for
example `https://oauth-origin.staging.0xkey.io/` together with a staging
`redirectUri`. The value must be `https://` without a query or fragment and is
bound to the OAuth transaction like the redirect URI.
