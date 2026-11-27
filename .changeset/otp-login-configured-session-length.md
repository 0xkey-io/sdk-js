---
"@0xkey-io/core": patch
"@0xkey-io/react-wallet-kit": patch
"@0xkey-io/react-native-wallet-kit": patch
---

OTP sign-in now uses the session length configured in the Dashboard (or in the
provider config when no Auth Proxy config is used), like passkey, wallet and
OAuth sign-in already do. Before, `loginWithOtp`, `signUpWithOtp` and
`completeOtp` in the React and React Native wallet kits always asked for a
900-second session when Attested login was available. `signUpWithOtp` and
`completeOtp` in core accept an optional `expirationSeconds` and pass it to the
login that follows. An `expirationSeconds` passed by the caller still wins.
