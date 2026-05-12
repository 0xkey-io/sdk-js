---
title: "Ethers"
description: "[`@0xkey-io/ethers`](https://www.npmjs.com/package/@0xkey-io/ethers) exports a `ZeroXKeySigner` that serves as a drop-in replacement for an Ethers signer."
mode: wide
---

Out of the box, it supports `{ signTransaction | signMessage | signTypedData }`. See full implementation [here](https://github.com/0xkey-io/sdk-js/tree/main/packages/ethers) for more details and examples. Note that you must **bring your own provider and connect it** to the ZeroXKeySigner.

```js
// Initialize a ZeroXKey Signer
const zeroXKeySigner = new ZeroXKeySigner({
  ...
});

// Bring your own provider (such as Alchemy or Infura: https://docs.ethers.org/v6/api/providers/)
const network = "goerli";
const provider = new ethers.providers.InfuraProvider(network);
const connectedSigner = zeroXKeySigner.connect(provider);
```
