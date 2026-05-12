---
title: "CosmJS"
description: "[`@0xkey-io/cosmjs`](https://www.npmjs.com/package/@0xkey-io/cosmjs) exports a `ZeroXKeyDirectWallet` that serves as a drop-in replacement for a CosmJS direct wallet. It includes support for `signDirect`. See full implementation [here](https://github.com/0xkey-io/sdk-js/tree/main/packages/cosmjs) for more details and examples."
mode: wide
---

```js
// Initialize a ZeroXKey Signer
const zeroXKeySigner = await ZeroXKeyDirectWallet.init({
  config: {
    ...
  },
  prefix: "celestia", // can be replaced with other Cosmos chains
});

const account = refineNonNull((await zeroXKeySigner.getAccounts())[0]);
const compressedPublicKey = toHex(account.pubkey);
const selfAddress = account.address;
```
