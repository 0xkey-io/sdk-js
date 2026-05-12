---
title: "WebauthnStamper"
---

## Introduction

The [`@0xkey-io/webauthn-stamper`](https://www.npmjs.com/package/@0xkey-io/webauthn-stamper) package is used for stamping requests made to ZeroXKey's API with WebAuthn credentials, but specifically for use with passkeys.

For more information on passkeys and WebAuthn refer to [this section](/authentication/passkeys/introduction).

## Installing

To get started install the [`@0xkey-io/webauthn-stamper`](https://www.npmjs.com/package/@0xkey-io/webauthn-stamper) client.

<CodeGroup>

```bash npm
npm i @0xkey-io/webauthn-stamper
```

```bash pnpm
pnpm i @0xkey-io/webauthn-stamper
```

```bash yarn
yarn add @0xkey-io/webauthn-stamper
```

</CodeGroup>

## Initializing

The `WebauthnStamper` class is a utility designed to facilitate the process of creating a digital stamp using WebAuthn credentials. This stamp is essential for authenticating requests made to a web server or API that utilizes WebAuthn for secure, passwordless authentication. You can initialize a new `WebauthnStamper` using the WebauthnStamper constructor:

### `constructor(config: TWebauthnStamperConfig): WebauthnStamper`

#### Parameters

<ParamField
body="config"
type="TWebauthnStamperConfig"
required

>

An object containing configuration settings for the stamper.
</ParamField>
<ParamField
body="rpId"
type="string"
required

>

The RPID ("Relying Party ID") for your origin. For an origin named `https://www.example.com`, the RPID is typically `example.com`. If you're testing on localhost, the RPID should be `localhost`.
</ParamField>
<ParamField
body="timeout"
type="number"

>

The time in milliseconds before the stamp request times out. Defaults to 300000 milliseconds (5 minutes) if not specified.
</ParamField>
<ParamField
body="userVerification"
type="UserVerificationRequirement"

>

Specifies the user verification requirements. Can be set to values like `required`, `preferred`, or `discouraged`. Defaults to `preferred` if not provided.
</ParamField>
<ParamField
body="allowCredentials"
type="PublicKeyCredentialDescriptor[]"

>

An array of credential descriptors specifying the credentials to be allowed during authentication. This is optional and defaults to an empty array.
</ParamField>

#### Types

##### `TWebauthnStamperConfig`

```js
type TWebauthnStamperConfig = {
  rpId: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: PublicKeyCredentialDescriptor[];
};
```

##### `UserVerificationRequirement`

```js
type UserVerificationRequirement = "discouraged" | "preferred" | "required";
```

Refer to our guide on [using passkeys](/authentication/passkeys/options#userverification) for more information on this type and its usage.

##### `PublicKeyCredentialDescriptor`

```js
interface PublicKeyCredentialDescriptor {
  id: BufferSource;
  transports?: AuthenticatorTransport[];
  type: PublicKeyCredentialType;
}
```

Refer to our guide on [using passkeys](/authentication/passkeys/options#allowcredentials) for more information on this type and its usage.

#### Example

```js
import { WebauthnStamper } from "@0xkey-io/webauthn-stamper";
import { ZeroXKeyClient } from "@0xkey-io/http";

const stamper = new WebAuthnStamper({
  rpId: "example.com",
});

// New HTTP client able to sign with passkeys!
const httpClient = new ZeroXKeyClient(
  { baseUrl: "https://api.0xkey.com" },
  stamper,
);
```

## Methods

### `stamp: (input: string) => Promise<TStamp>`

Creates a digital stamp, which includes the public key, signature scheme, and a signature based on WebAuthn credentials.

#### Parameters

<ParamField
body="input"
type="string"
required

>

The ZeroXKey activity request, or query to be sent to ZeroXKey's API.
</ParamField>

#### Types

##### `TStamp`

```js
type TStamp = {
  stampHeaderName: string;
  stampHeaderValue: string;
};
```
