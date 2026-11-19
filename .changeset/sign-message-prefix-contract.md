---
"@0xkey-io/core": patch
"@0xkey-io/react-wallet-kit": patch
---

Correct the documented default of `addEthereumPrefix` for `signMessage` and
`handleSignMessage`. Runtime behavior is unchanged: when the option is omitted,
embedded Ethereum accounts sign the raw message without the EIP-191 prefix, so
the signature does not verify with `personal_sign` or viem/ethers
`verifyMessage`. The JSDoc previously said the prefix was added by default for
Ethereum. Pass `addEthereumPrefix: true` when you need an EIP-191 signature;
connected Ethereum wallets still require `true`.
