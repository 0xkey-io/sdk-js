---
"@0xkey-io/core": patch
"@0xkey-io/react-wallet-kit": patch
"@0xkey-io/react-native-wallet-kit": patch
---

Session length now follows one rule on every sign-in, sign-up and refresh path:
the value passed to the call, then the Dashboard value, then the local config,
then 900 seconds. A value that is empty, not a number or not above zero (for
example `"0"`, `"-5"` or `"abc"`) counts as unset, so the next source applies
instead of the value being sent to the server. `refreshSession` in both wallet
kits now uses the Dashboard value when the call passes none. Core exports
`parseSessionExpirationSeconds` and `resolveSessionExpirationSeconds` for this.
