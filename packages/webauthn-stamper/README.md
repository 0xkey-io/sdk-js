---
title: "WebAuthn Stamper"
---

# @0xkey-io/webauthn-stamper

[![npm](https://img.shields.io/npm/v/@0xkey-io/webauthn-stamper?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/webauthn-stamper)

This package contains functions to stamp a ZeroXKey request. It is meant to be used with [`@0xkey-io/http`](https://www.npmjs.com/package/@0xkey-io/http)

Usage:

```ts
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
