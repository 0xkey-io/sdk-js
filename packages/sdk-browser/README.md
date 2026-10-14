# ⚠️ Deprecated: Use the New Core SDK

> This package is deprecated and no longer actively maintained.
>
> We’ve released a new, improved core TypeScript client-side SDK package — [@0xkey-io/core](https://docs.0xkey.io/sdks/typescript-frontend) which provides a simpler, more powerful developer experience and better integration with modern JS frameworks.
>
> If you’re using React, please consider using the [@0xkey-io/react-wallet-kit](https://docs.0xkey.io/sdks/react/index) for a more tailored experience.

# @0xkey-io/sdk-browser

[![npm](https://img.shields.io/npm/v/@0xkey-io/sdk-browser?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/sdk-browser)

A SDK client with browser-specific abstractions for interacting with [ZeroXKey](https://0xkey.io) API. Also includes [@0xkey-io/http](https://www.npmjs.com/package/@0xkey-io/http), a lower-level, fully typed HTTP client.

0xkey API documentation lives here: https://docs.0xkey.io.

## Getting started

```bash
$ npm install @0xkey-io/sdk-browser
```

### Initialize

```typescript
import { ZeroXKey } from "@0xkey-io/sdk-browser";

const zeroXKey = new ZeroXKey({
  apiBaseUrl: "https://api.0xkey.io",
  defaultOrganizationId: process.env.ZEROXKEY_ORGANIZATION_ID,
  // Optional: Your relying party ID - for use with Passkey authentication
  rpId: process.env.ZEROXKEY_RP_ID,
});
```

### 0xkey Clients

#### Passkey

The Passkey client allows for authentication to 0xkey's API using Passkeys.

```typescript
const passkeyClient = zeroXKey.passkeyClient();

// User will be prompted to login with their passkey
await passkeyClient.login();

// Make authenticated requests to 0xkey API, such as listing user's wallets
const walletsResponse = await passkeyClient.getWallets();
```

#### Iframe

The Iframe client can be initialized to interact with 0xkey's hosted iframes for sensitive operations.
The `iframeContainer` parameter is required, and should be a reference to the DOM element that will host the iframe.
The `iframeUrl` is the URL of the iframe you wish to interact with.

The example below demonstrates how to initialize the Iframe client for use with [Email Auth](https://docs.0xkey.io/embedded-wallets/sub-organization-auth)
by passing in `https://authproxy.0xkey.io` as the `iframeUrl`.

```typescript
const iframeClient = await zeroXKey.iframeClient({
  // The container element that will host the iframe
  iframeContainer: document.getElementById("<iframe container id>"),
  iframeUrl: "https://authproxy.0xkey.io",
});

const injectedResponse = await iframeClient.injectCredentialBundle(
  "<Credential from Email>",
);
if (injectedResponse) {
  await iframeClient.getWallets();
}
```

##### IFrame URLs:

| Flow                                                                               | URL                                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| [Email Auth](https://docs.0xkey.io/embedded-wallets/sub-organization-auth)         | [authproxy.0xkey.io](https://authproxy.0xkey.io) |
| [Email Recovery](https://docs.0xkey.io/embedded-wallets/sub-organization-recovery) | [recovery.0xkey.io](https://recovery.0xkey.io)   |
| [Import Wallet](https://docs.0xkey.io/features/import-wallets)                     | [import.0xkey.io](https://import.0xkey.io)       |
| [Export Wallet](https://docs.0xkey.io/features/export-wallets)                     | [export.0xkey.io](https://export.0xkey.io)       |

#### Wallet

The Wallet client is designed for using your Solana or EVM wallet to stamp and approve activity requests for 0xkey's API.
This stamping process leverages the wallet's signature to authenticate requests.

The example below showcases how to use an injected Ethereum wallet to stamp requests to 0xkey's API.
The user will be prompted to sign a message containing the activity request payload to be sent to 0xkey.

```typescript
import {
  createWalletClient,
  custom,
  recoverPublicKey,
  hashMessage,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

import { WalletStamper, EthereumWallet } from "@0xkey-io/wallet-stamper";

const walletClient = zeroXKey.walletClient(new EthereumWallet());

// Make authenticated requests to 0xkey API, such as listing user's wallets
// User will be prompted to sign a message to authenticate the request
const walletsResponse = await walletClient.getWallets();
```

## Helpers

`@0xkey-io/sdk-browser` provides `ZeroXKeySDKBrowserClient`, which offers wrappers around commonly used 0xkey activities, such as creating new wallets and wallet accounts.

### IndexedDB Sessions (Recommended)

0xkey now supports persistent, **secure, non-extractable authentication** using P-256 passkeys stored in **IndexedDB**. This replaces legacy iframe-based flows for otp, passkey, and OAuth authentication.

The [`ZeroXKeyIndexedDbClient`](https://github.com/0xkey-io/sdk-js/blob/main/packages/sdk-browser/src/__clients__/browser-clients.ts) provides a long-lived session mechanism where the private key never leaves the browser and is scoped per sub-organization. This client handles login, session persistence, and API request signing entirely on the client side — without requiring iframes or sensitive credential injection.

```ts
import { ZeroXKey } from "@0xkey-io/sdk-browser";

const zeroXKey = new ZeroXKey({
  apiBaseUrl: "https://api.0xkey.io",
  defaultOrganizationId: "<YOUR_PARENT_ORG_ID>",
  rpId: "<YOUR_WEBAUTHN_RELYING_PARTY_ID>",
});

const client = zeroXKey.indexedDbClient();
const passkeyClient = zeroXKey.passkeyClient();
// Create authenticated session
const pubKey = await indexedDbClient!.getPublicKey();
await passkeyClient?.loginWithPasskey({
  sessionType: SessionType.READ_WRITE,
  publicKey: pubKey!,
  expirationSeconds: "3600",
});

// Now the client is authenticated and ready to interact with 0xkey API
const wallets = await client.getWallets();
```

> 💡 **Why IndexedDB?**  
> Keys are stored using the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey), marked as `nonExtractable`, and survive page reloads — offering persistent, tamper-resistant authentication without ever exposing the raw key material.

---

### ⚠️ Deprecated: iframeClient for Auth

Authentication via `iframeClient()` and injected credentials (e.g., from `https://authproxy.0xkey.io`) is now considered **deprecated** for new integrations. These flows required sensitive credential bundles to be delivered via email or OAuth and injected into a sandboxed iframe — a pattern with limited persistence and higher complexity.

Developers are encouraged to migrate to `indexedDbClient()` for:

- Seamless passkey authentication
- Improved security model (no credential injection)
- Long-lived, resumable sessions

Existing iframe use cases like **Email Recovery**, **Wallet Import**, and **Wallet Export** are still supported but should be isolated from authentication logic.
