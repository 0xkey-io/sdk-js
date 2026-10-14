---
"@0xkey-io/core": patch
"@0xkey-io/http": patch
"@0xkey-io/sdk-browser": patch
"@0xkey-io/sdk-server": patch
"@0xkey-io/react-wallet-kit": patch
"@0xkey-io/react-native-wallet-kit": patch
---

Use the canonical "0xkey" brand in user-visible strings. New passkeys added
without a name are called `0xkey Passkey-<timestamp>` (existing passkeys keep
their names), request errors read `0xkey error <code>: …`, and SDK warnings
say "0xkey SDK". Public identifiers such as `ZeroXKeyError` and
`ZeroXKeyProvider` are unchanged.
