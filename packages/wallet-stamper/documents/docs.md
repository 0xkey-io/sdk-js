---
title: "WalletStamper"
---

## Introduction

The [`@0xkey-io/wallet-stamper`](https://www.npmjs.com/package/@0xkey-io/wallet-stamper) package provides a flexible mechanism for using your Solana or EVM wallet to stamp and approve activity requests for ZeroXKey's API. This stamping process leverages your wallet's signature key to authenticate requests securely.

## Installing

To get started, install the [`@0xkey-io/wallet-stamper`](https://www.npmjs.com/package/@0xkey-io/wallet-stamper) client.

<CodeGroup>

```bash npm
npm i @0xkey-io/wallet-stamper
```

```bash pnpm
pnpm i @0xkey-io/wallet-stamper
```

```bash yarn
yarn add @0xkey-io/wallet-stamper
```

</CodeGroup>
## Initializing

The `WalletStamper` class implements the `TStamper` interface used by the [ZeroXKeyClient](/sdks/advanced/0xkey-client) in the [`@0xkey-io/http`](https://www.npmjs.com/package/@0xkey-io/http) package. It encapsulates the logic necessary to sign activity requests using your wallet and generate the appropriate HTTP headers for authentication.

### `constructor(wallet: WalletInterface): TStamper`

#### Parameters

<ParamField
body="wallet"
type="WalletInterface"
required

>

An object representing your wallet, either a Solana or EVM wallet.
</ParamField>

<ParamField
body="type"
type="string"
required

>

The type of wallet, either `solana` or `evm`.
</ParamField>

<ParamField
body="signMessage"
type="function"
required

>

A function that signs a message using your wallet's private key.
</ParamField>

<ParamField
body="recoverPublicKey"
type="function"
required

>

A function that recovers the public key from the signed message (required for EVM wallets).
</ParamField>

#### Types

##### `SolanaWalletInterface`

```js
export interface SolanaWalletInterface extends BaseWalletInterface {
  recoverPublicKey: () => string;
  type: "solana";
}
```

##### `EvmWalletInterface`

```js
export interface EvmWalletInterface extends BaseWalletInterface {
  recoverPublicKey: (message: string, signature: string) => Promise<string>;
  type: "evm";
}
```

##### `WalletInterface`

```js
export type WalletInterface = SolanaWalletInterface | EvmWalletInterface;
```

## Methods

### `stamp: (input: string) => Promise<TStamp>`

Signs the payload using the wallet's private key and returns the stamp to be used in the HTTP headers for authenticating requests to ZeroXKey's API.

#### Parameters

<ParamField
body="payload"
type="string"
required

>

The payload that to be stamped. This is the stringified JSON request body that you want to send to ZeroXKey's API.
</ParamField>

#### Types

##### `TStamp`

```js
type TStamp = {
  stampHeaderName: string;
  stampHeaderValue: string;
};
```

##### `TStamper`

```js
interface TStamper {
  stamp: (input: string) => Promise<TStamp>;
}
```

## Example

The example below shows how to initialize and use the `WalletStamper` with the `ZeroXKeyClient` to make a request to ZeroXKey's [`/public/v1/query/whoami`](/api-reference/sessions/who-am-i) endpoint:

```js
// Import the dependencies for the Solana
import { Keypair } from "@solana/web3.js";
import { decodeUTF8 } from "tweetnacl-util";
import nacl from "tweetnacl";

import { ZeroXKeyClient } from "@0xkey-io/http";
import { WalletStamper, SolanaWalletInterface } from "@0xkey-io/wallet-stamper";

class SolanaWallet implements SolanaWalletInterface {
  keypair = Keypair.fromSecretKey(SOLANA_PRIVATE_KEY);
  type = "solana" as const;

  async signMessage(message: string): Promise<string> {
    const messageBytes = decodeUTF8(message);
    const signature = nacl.sign.detached(messageBytes, this.keypair.secretKey);
    return Buffer.from(signature).toString("hex");
  }

  recoverPublicKey(): string {
    // Convert the base24 encoded Solana wallet public key (the one displayed in the wallet)
    // into the ed25519 decoded public key
    const ed25519PublicKey = Buffer.from(
      this.keypair.publicKey.toBuffer(),
    ).toString("hex");
    return ed25519PublicKey;
  }
}

// Instantiate the WalletStamper with the SolanaWallet
const walletStamper = new WalletStamper(new SolanaWallet());

// Instantiate the ZeroXKeyClient with the WalletStamper
const client = new ZeroXKeyClient({ baseUrl: BASE_URL }, walletStamper);

// You're now ready to make requests to ZeroXKey's API 🎉
```

## Conclusion

The `WalletStamper` class provides a seamless integration with ZeroXKey's API, enabling you to leverage your existing wallet for secure, authenticated requests. By following this guide, you can quickly set up and start using `WalletStamper` in your projects.
