# @0xkey-io/http

[![npm](https://img.shields.io/npm/v/@0xkey-io/http?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/http)

A lower-level, fully typed HTTP client for interacting with [ZeroXKey](https://0xkey.com) API.

For signing transactions and messages, check out the higher-level [`@0xkey-io/ethers`](https://www.npmjs.com/package/@0xkey-io/ethers) or [`@0xkey-io/viem`](https://www.npmjs.com/package/@0xkey-io/viem) signers.

ZeroXKey API documentation lives here: https://docs.0xkey.com.

## Getting started

```bash
$ npm install @0xkey-io/http
```

```typescript
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";
import { ZeroXKeyClient } from "@0xkey-io/http";

// This stamper produces signatures using the API key pair passed in.
const stamper = new ApiKeyStamper({
  apiPublicKey: "...",
  apiPrivateKey: "...",
});

// The ZeroXKey client uses the passed in stamper to produce signed requests
// and sends them to ZeroXKey
const client = new ZeroXKeyClient(
  {
    baseUrl: "https://api.0xkey.com",
  },
  stamper,
);

// Now you can make authenticated requests!
const data = await client.getWhoami({
  organizationId: "<Your organization id>",
});
```

## HTTP fetchers

`@0xkey-io/http` provides fully typed http fetchers for interacting with the ZeroXKey API. You can find all available methods [here](/packages/http/src/__generated__/services/coordinator/public/v1/public_api.fetcher.ts). The types of input parameters and output responses are also exported for convenience.

The OpenAPI spec that generates all fetchers is also [included](/packages/http/src/__generated__/services/coordinator/public/v1/public_api.swagger.json) in the package.

## `withAsyncPolling(...)` helper

All ZeroXKey mutation endpoints are asynchronous (with the exception of private key-related signing endpoints, e.g. `/submit/sign_transaction`, `/submit/sign_raw_payload`). To help you simplify async mutations, `@0xkey-io/http` provides a `withAsyncPolling(...)` wrapper. Here's a quick example:

```typescript
import { withAsyncPolling, ZeroXKeyActivityError } from "@0xkey-io/http";

// Use `withAsyncPolling(...)` to wrap & create a fetcher with built-in async polling support
const fetcher = withAsyncPolling({
  request: client.createPrivateKeys,
});

// The fetcher remains fully typed. After submitting the request,
// it'll poll until the activity reaches a terminal state.
try {
  const activity = await fetcher({
    body: {
      /* ... */
    },
  });

  // Success!
  console.log(
    activity.result.createPrivateKeysResultV2?.privateKeys?.[0]?.privateKeyId,
  );
} catch (error) {
  if (error instanceof ZeroXKeyActivityError) {
    // In case the activity is rejected, failed, or requires consensus,
    // a rich `ZeroXKeyActivityError` will be thrown. You can read from
    // `ZeroXKeyActivityError` to find out why the activity didn't succeed.
    //
    // For instance, if your activity requires consensus and doesn't have
    // enough approvals, you can get the `activityId` from `ZeroXKeyActivityError`,
    // store it somewhere, then re-fetch the activity via `.postGetActivity(...)`
    // when the required approvals/rejections are in place.
  }
}
```

## More examples

See [`createNewEthereumPrivateKey.ts`](/examples/with-ethers/src/createNewEthereumPrivateKey.ts) in the [`with-ethers`](/examples/with-ethers/) example.

## See also

- [`@0xkey-io/ethers`](https://www.npmjs.com/package/@0xkey-io/ethers): ZeroXKey Signer for [`Ethers`](https://docs.ethers.org/v6/api/providers/#Signer)
- [`@0xkey-io/viem`](https://www.npmjs.com/package/@0xkey-io/viem): ZeroXKey Custom Account for [`Viem`](https://viem.sh/docs/accounts/custom.html)
