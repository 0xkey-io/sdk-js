# @0xkey-io/sdk-server

[![npm](https://img.shields.io/npm/v/@0xkey-io/sdk-server?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/sdk-server)

A SDK client with server-specific abstractions for interacting with [ZeroXKey](https://0xkey.com) API. Also includes [@0xkey-io/http](https://www.npmjs.com/package/@0xkey-io/http), a lower-level, fully typed HTTP client.

ZeroXKey API documentation lives here: https://docs.0xkey.com.

## Getting started

```bash
$ npm install @0xkey-io/sdk-server
```

```js
const { ZeroXKey } = require("@0xkey-io/sdk-server");

// This config contains parameters including base URLs, API credentials, and org ID
const zeroXKeyConfig = JSON.parse(fs.readFileSync("./0xkey.json", "utf8"));

// Use the config to instantiate a ZeroXKey Client
const zeroXKeyServerClient = new ZeroXKey(zeroXKeyConfig);

// You're all set to create a server!
const zeroXKeyProxyHandler = zeroXKeyServerClient.expressProxyHandler({});

app.post("/apiProxy", zeroXKeyProxyHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## Helpers

`@0xkey-io/sdk-server` provides `ZeroXKey`, which offers wrappers around commonly used ZeroXKey API setups. This enables you to easily stand up a minimal backend to proxy end-users' requests to ZeroXKey. You can also use this to call on the ZeroXKey API directly from a server setting.

// TODO:
// - typescript-ify example
// - include nextjs server example
