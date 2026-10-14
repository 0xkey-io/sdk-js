---
"@0xkey-io/react-native-wallet-kit": patch
---

Add `signerEnvironment` (`"prod"` default, or `"staging"`) to the provider
config. `exportWallet`, `exportWalletAccount`, `exportPrivateKey`,
`importWallet` and `importPrivateKey` verify the enclave bundle against the
pinned Signer key of that environment. Previously they always used the
production key, so every export and import against staging failed with
"expected signer key ... does not match signer key from bundle".
