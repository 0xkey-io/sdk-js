---
title: "Cosmjs"
---

# @0xkey-io/cosmjs

[![npm](https://img.shields.io/npm/v/@0xkey-io/cosmjs?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/cosmjs)

Experimental [ZeroXKey](https://0xkey.com) Cosmos Signer for [`CosmJS`](https://github.com/cosmos/cosmjs):

- `ZeroXKeyDirectWallet` is a drop-in replacement for [`DirectSecp256k1Wallet`](https://github.com/cosmos/cosmjs/blob/e8e65aa0c145616ccb58625c32bffe08b46ff574/packages/proto-signing/src/directsecp256k1wallet.ts#LL14C14-L14C35) that conforms to the `OfflineDirectSigner` interface.

If you need a lower-level, fully typed HTTP client for interacting with ZeroXKey API, check out [`@0xkey-io/http`](https://www.npmjs.com/package/@0xkey-io/http).

See more documentation at https://docs.0xkey.com/.

## Getting started

```bash
$ npm install @0xkey-io/cosmjs
```

## Examples

| Example                                                                            | Description                                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`with-cosmjs`](https://github.com/0xkey-io/sdk-js/tree/main/examples/with-cosmjs) | Create a new Cosmos address, then sign and broadcast a transaction on Celestia testnet via CosmJS |

## See also

- [`@0xkey-io/http`](https://www.npmjs.com/package/@0xkey-io/http): lower-level fully typed HTTP client for interacting with ZeroXKey API
