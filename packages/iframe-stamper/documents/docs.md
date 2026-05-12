---
title: "IframeStamper"
---

## Introduction

The [`@0xkey-io/iframe-stamper`](https://www.npmjs.com/package/@0xkey-io/iframe-stamper) package, while sharing a similar purpose with the `@0xkey-io/api-key-stamper`, caters specifically to the unique context of iframes. This package is designed for stamping requests within an iframe, using credentials for ZeroXKey's API, but operates distinctly from the API key stamper. Unlike the API key stamper, which has direct access to the API private key to compute signatures or stamps directly, the iframe stamper interacts with credentials in a more indirect manner.

It leverages the `postMessage` communication mechanism to send and receive messages within the iframe, ensuring the credential does not leave its secure environment. This approach is particularly crucial in sensitive flows such as [Email Auth](/authentication/email), and [Key or Wallet Export](/wallets/export-wallets), where heightened security is required. The `@0xkey-io/iframe-stamper` works in tandem with `@0xkey-io/http`, facilitating secure and efficient communication in these specific use cases.

By bridging the gap between the iframe's isolated environment and ZeroXKey's API, the iframe stamper plays a pivotal role in maintaining the integrity and security of the credential while ensuring seamless operation within the iframe context.

## Installing

To start using the `@0xkey-io/iframe-stamper` client, install it as follows:

<CodeGroup>

```bash npm
npm i @0xkey-io/iframe-stamper
```

```bash pnpm
pnpm i @0xkey-io/iframe-stamper
```

```bash yarn
yarn add @0xkey-io/iframe-stamper
```

</CodeGroup>

## Initializing

The IframeStamper class, part of the @0xkey-io/iframe-stamper package, is designed for stamping ZeroXKey requests through credentials in an iframe. It's used with @0xkey-io/http for constructing various flows. The class can manage iframe interactions for credential insertion, wallet exports, and request stamping. Here's how you can initialize an IframeStamper:

### `constructor(config: TIframeStamperConfig): IframeStamper`

#### Parameters

<ParamField
body="config"
type="TIframeStamperConfig"
required

>

An object containing configuration settings for the iframe stamper.
</ParamField>
<ParamField
body="iframeUrl"
type="string"
required

>

The URL of the iframe to be used.
</ParamField>
<ParamField
body="iframeElementId"
type="string"
required

>

The ID to assign to the iframe element.
</ParamField>
<ParamField
body="iframeContainer"
type="HTMLElement | null | undefined"
required

>

The container element in which the iframe will be inserted.
</ParamField>

#### Types

##### `TIframeStamperConfig`

```js
type TIframeStamperConfig = {
  iframeUrl: string;
  iframeElementId: string;
  iframeContainer: HTMLElement | null | undefined;
};
```

#### Example

For full example check out the [email-auth](https://github.com/0xkey-io/sdk-js/tree/main/examples/email-auth) example in our SDK repo. You should also read up [Email Auth](/authentication/email) for more information on the technical details of how it works.

## Methods

### `init: () => Promise<string>`

Initializes the iframe stamper by inserting the iframe into the DOM and establishing communication with it. This method returns a promise that resolves to the iframe's public key, which is used for subsequent operations like credential injection or request stamping.

#### Example

```js
import { IframeStamper } from "@0xkey-io/iframe-stamper";
import { ZeroXKeyClient } from "@0xkey-io/http";

const ZeroXKeyIframeContainerId = "0xkey-iframe-container";
const ZeroXKeyIframeElementId = "0xkey-iframe";

const iframeStamper = new IframeStamper({
  iframeUrl: process.env.IFRAME_URL!,
  iframeContainer: document.getElementById(ZeroXKeyIframeContainerId),
  iframeElementId: ZeroXKeyIframeElementId,
});

// This inserts the iframe in the DOM and returns the public key
const publicKey = await iframeStamper.init();
```

### `injectCredentialBundle: (bundle: string) => Promise<boolean>`

Injects a new credential bundle into the iframe, a process used in email authentication flows. The method requires an encrypted credential bundle, which should be encrypted to the iframe's initial public key using HPKE ([RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html)). Upon successful execution, it returns a `Promise<boolean>` that resolves to `true` if the bundle was successfully injected into the iframe, or `false` otherwise.

#### Parameters

<ParamField
body="bundle"
type="string"
required

>

The encrypted credential bundle that needs to be injected into the iframe. This bundle should be encrypted with the iframe's initial public key using HPKE ([RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html)).
</ParamField>

#### Example

```
// .. Add imports and init iframeStamper

// Pasted into the iFrame by the user
const credentialBundle = "<your-encrypted-credentials-bundle>";

// Injects a new credential in the iframe
const injected = await iframeStamper.injectCredentialBundle(credentialBundle);
```

### `injectKeyExportBundle: (bundle: string) => Promise<boolean>`

Injects an export bundle into the iframe. This method is used during key export flows. The bundle should be encrypted to the iframe's initial public key using HPKE ([RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html)). This method returns a `Promise<boolean>` which resolves to `true` if the bundle was successfully injected into the iframe, or `false` otherwise.

#### Parameters

<ParamField
body="bundle"
type="string"
required

>

The encrypted export bundle that needs to be injected into the iframe. This bundle should be encrypted with the iframe's initial public key using HPKE ([RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html)).
</ParamField>

#### Example

```js
// .. Add imports and init the IframeStamper

// Pasted into the iFrame by the user
const walletExportBundle = "<your-encrypted-wallet-export-bundle>";

const injected =
  await iframeStamper.injectWalletExportBundle(walletExportBundle);
```

### `injectWalletExportBundle: (bundle: string) => Promise<boolean>`

Injects a wallet export bundle into the iframe. This method is typically used during wallet export flows. The bundle should be encrypted to the iframe's initial public key using HPKE (RFC 9180). It returns a `Promise<boolean>` which resolves to `true` if the bundle is successfully injected into the iframe, or `false` otherwise.

#### Parameters

<ParamField
body="bundle"
type="string"
required

>

The encrypted wallet export bundle to be injected into the iframe. This bundle must be encrypted using the iframe's initial public key according to HPKE (RFC 9180) standards.
</ParamField>

#### Example

```js
// .. Add imports and init the IframeStamper

// Pasted into the iFrame by the user
const walletExportBundle = "<your-encrypted-wallet-export-bundle>";

const injected =
  await iframeStamper.injectWalletExportBundle(walletExportBundle);
```

### `publicKey: () => string | null`

Returns the public key of the iframe, or `null` if the underlying iframe isn't properly initialized. This method is useful for retrieving the public key which is necessary for various operations like credential injection or request stamping.

#### Example

```js
// .. Add imports and init the IframeStamper

const iframePublicKey = iframeStamper.publicKey();
```

### `clear: () => void`

Removes the iframe from the DOM. This method is useful for cleaning up the iframe when it is no longer needed. It ensures that the iframe is properly disposed of, preventing potential memory leaks or other unintended side effects.

#### Example

```js
// .. Add imports and init the IframeStamper

iframeStamper.clear();
```
