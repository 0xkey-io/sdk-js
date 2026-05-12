---
title: "ApiKeyStamper"
---

## Introduction

The [`@0xkey-io/api-key-stamper`](https://www.npmjs.com/package/@0xkey-io/api-key-stamper) package simplifies the process of using your public/private API keys and passkeys to stamp and approve activity requests for ZeroXKey's API. This stamping mechanism is central to the API's security, ensuring that each request is authenticated and authorized. For an in-depth understanding of API keys see [this section](/faq#why-do-you-require-a-public--private-key-pair-to-access-0xkey-api).

## Installing

To get started install the [`@0xkey-io/api-key-stamper`](https://www.npmjs.com/package/@0xkey-io/api-key-stamper) client.

<CodeGroup>

```bash npm
pnpm i @0xkey-io/api-key-stamper
```

```bash pnpm
pnpm i @0xkey-io/api-key-stamper
```

```bash yarn
yarn add @0xkey-io/api-key-stamper
```

</CodeGroup>

## Initializing

The `ApiKeyStamper` class implements the `TStamper` interface used by the [ZeroXKeyClient](/sdks/advanced/0xkey-client) in the `@0xkey-io/http` module. It encapsulates the logic necessary to sign activity requests and generates the appropriate HTTP headers for authentication. To get started with an `ApiKeyStamper`, you can initialize it using its constructor:

### `constructor(config: TApiKeyStamperConfig): TStamper`

<ParamField
body="config"
type="TApiKeyStamperConfig"
required

>

An object containing configuration settings for the stamper.
</ParamField>

<ParamField
body="apiPrivateKey"
type="string"
required

>

Your ZeroXKey API private key.
</ParamField>

<ParamField
body="apiPublicKey"
type="string"
required

>

Your ZeroXKey API public key.
</ParamField>

### Types

#### `TApiKeyStamperConfig`

```js
type TApiKeyStamperConfig = {
  apiPublicKey: string;
  apiPrivateKey: string;
};
```

#### `TStamper`

```js
interface TStamper {
  stamp: (input: string) => Promise<TStamp>;
};
```

#### Example

The example below shows how to initialize and use the `ApiKeyStamper` with the `ZeroXKeyClient` to make a request to ZeroXKey's [`/public/v1/query/whoami`](/api-reference/sessions/who-am-i) endpoint:

```js
import { ZeroXKeyClient } from "@0xkey-io/http";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";

// Following best practices, define parameters in your .env file
const baseUrl = process.env.ZEROXKEY_BASE_URL || "https://api.0xkey.com";
const apiPublicKey = process.env.ZEROXKEY_API_PUBLIC_KEY;
const apiPrivateKey = process.env.ZEROXKEY_API_PRIVATE_KEY;

// Initialize the API key stamper
const stamper = new ApiKeyStamper({ apiPublicKey, apiPrivateKey });

// Initialize the ZeroXKey client
const tk = new ZeroXKeyClient({ baseUrl }, stamper);

// Now you can make authenticated requests using the APIKeyStamper
const whoami = await tk.getWhoami({
  organizationId: "<Your Org ID>",
});
```

## Methods

### `stamp: (input: string) => Promise<TStamp>`

Creates a digital stamp which includes the public key, signature scheme, and a signature.

#### Parameters

<ParamField
body="payload"
type="string"
required

>

The payload that needs to be stamped.
</ParamField>

#### Types

##### `TStamp`

```js
type TStamp = {
  stampHeaderName: string;
  stampHeaderValue: string;
};
```
