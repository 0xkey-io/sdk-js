---
title: "API Key Stamper"
---

# @0xkey-io/api-key-stamper

[![npm](https://img.shields.io/npm/v/@0xkey-io/api-key-stamper?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/api-key-stamper)

This package contains functions to stamp a ZeroXKey request. It is meant to be used with [`@0xkey-io/http`](https://www.npmjs.com/package/@0xkey-io/http)

Usage:

```ts
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";
import { ZeroXKeyClient } from "@0xkey-io/http";

const stamper = new ApiKeyStamper({
  apiPublicKey: "...",
  apiPrivateKey: "...",
});

const httpClient = new ZeroXKeyClient(
  { baseUrl: "https://api.0xkey.com" },
  stamper,
);
```
