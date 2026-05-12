---
title: "ZeroXKeyClient"
---

## Introduction

The [`@0xkey-io/http`](https://www.npmjs.com/package/@0xkey-io/http) package is a fully-typed lower-level HTTP client for developers integrating with ZeroXKey.

## Installing

To get started install the [`@0xkey-io/http`](https://www.npmjs.com/package/@0xkey-io/http) client.

<CodeGroup>

```bash npm
npm i @0xkey-io/http
```

```bash pnpm
pnpm i @0xkey-io/http
```

```bash yarn
yarn add @0xkey-io/http
```

</CodeGroup>

## Initializing

Create a new client for use in your JavaScript/Typescript applications.

You can initialize a new **`ZeroXKeyClient`** using the **`ZeroXKeyClient`** constructor. The **`ZeroXKeyClient`** serves as your entry point to interact with the ZeroXKey API.

### Parameters

<ParamField
body="config"
type="THttpConfig"
required

>

An object containing configuration settings for the client.

</ParamField>

<ParamField
body="baseUrl"
type="string"
required

>

The base URL for the ZeroXKey API. Note: An error `Missing base URL. Please verify env vars.` will be thrown if a value is not provided.

</ParamField>

<ParamField
body="stamper"
type="TStamper"
required

>

An instance of a stamper class (e.g. [**`ApiKeyStamper`**](/sdks/advanced/api-key-stamper)) used to create signatures for authenticating API requests.
</ParamField>
Currently ZeroXKey provides 3 stampers:

- applications signing requests with Passkeys or webauthn devices should use [`@0xkey-io/webauthn-stamper`](/sdks/advanced/webauthn-stamper)
- applications signing requests with API keys should use [`@0xkey-io/api-key-stamper`](/sdks/advanced/api-key-stamper)
- applications that need to sign requests within an iframe, particularly when handling sensitive operations like Auth, or Key or Wallet Export, should use the [`@0xkey-io/iframe-stamper`](/sdks/advanced/iframe-stamper).

You can also implement the TStamper interface yourself. For more information on implementing a custom stamper checkout the [API Design](/developer-reference/api-overview/intro) docs.

### Types

#### `THttpConfig`

```bash
type THttpConfig = {
  baseUrl: string;
};
```

#### `TStamper`

```bash
interface TStamper {
  stamp: (input: string) => Promise<TStamp>;
}
```

### Example

```js
import { ZeroXKeyClient } from "@0xkey-io/http";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";

// Following best practices, define parameters in your .env file
const baseUrl = process.env.ZEROXKEY_BASE_URL || "https://api.0xkey.com";
const apiPublicKey = process.env.ZEROXKEY_API_PUBLIC_KEY;
const apiPrivateKey = process.env.ZEROXKEY_API_PRIVATE_KEY;

// Initialize the API key stamper
const stamper = new ApiKeyStamper({ apiPublicKey, apiPrivateKey });

// Initialize the ZeroXKey client and then you're ready to use the ZeroXKey client! 🎉
const client = new ZeroXKeyClient({ baseUrl }, stamper);
```
