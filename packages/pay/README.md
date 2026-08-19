# @0xkey-io/pay

Buyer and seller SDK for x402 v2 `exact` and MPP `evm/charge`.

Pay v1 supports Base USDC only. A seller settles first. The merchant handler
runs only after the Base transaction is confirmed.

Implementation rules for protocol choice, save-before-send, `UNKNOWN`, and
resume live in
[`docs/protocol-selection-and-recovery.md`](./docs/protocol-selection-and-recovery.md).
Exact generated support facts live in
[`docs/generated-support.md`](./docs/generated-support.md).

## Seller

```ts
import { createPayServer } from "@0xkey-io/pay/server";
import { paymentMiddleware } from "@0xkey-io/pay/express";

const payments = createPayServer({
  network: "eip155:8453",
  organizationId: process.env.ZEROXKEY_ORGANIZATION_ID!,
  payTo: process.env.ZEROXKEY_PAY_TO! as `0x${string}`,
  apiKey: {
    publicKey: process.env.ZEROXKEY_PUBLIC_KEY!,
    privateKey: process.env.ZEROXKEY_PRIVATE_KEY!,
  },
  mppSecretKey: process.env.MPP_SECRET_KEY!,
});

app.use(
  paymentMiddleware(payments, {
    "GET /weather": { price: "$0.01", protocols: ["x402", "mpp"] },
  }),
);
```

The same core has `@0xkey-io/pay/hono` and `@0xkey-io/pay/next` adapters.
The handler receives `paymentId`. Use it as the idempotency key for writes.

If the handler returns 5xx, the payment receipt stays on the response. Pay v1
calls `onFulfillmentFailed` or logs `fulfillment_failed`; 0xkey does not yet
store that event durably, and it does not refund automatically.

## Buyer

```ts
import { createPayFetch } from "@0xkey-io/pay/client";

const payFetch = createPayFetch({
  account,
  allowHosts: ["api.example.com"],
  network: "eip155:8453",
  maxAmount: "$0.10",
  rpcUrls: { "eip155:8453": process.env.BASE_RPC_URL! },
  protocolPreference: ["x402", "mpp"],
  pendingPaymentStore,
});

const response = await payFetch("https://api.example.com/weather");
```

`account` uses Pay's narrow signer Interface: an EVM `address` plus
`signTypedData`. Standard Viem accounts satisfy it. For a 0xkey Company Wallet
or TEE-held key, create the account with `createAccount` from
`@0xkey-io/viem`, then pass it here. Pay deliberately does not expose the full
Viem `Account` type, so compatible Viem minor versions do not leak through the
payment seam. The 0xkey adapter already implements the typed-data signing used
by x402 and MPP; Pay does not copy a second wallet adapter. See the tested
[`with-x402` example](../../examples/with-x402/README.md#2-company-wallet-signing).

The buyer does not replace global `fetch`. It never falls back after signing.
HTTPS is required. For local development only, `allowInsecureLocalhost: true`
allows HTTP to `localhost`, `127.0.0.1`, and `[::1]`.

`pendingPaymentStore` is required by default. It is one durable slot for one
unresolved signed request. Its contract is:

- `protection` is `"aead"` or `"encryption+hmac"`.
- The encryption or HMAC key is outside the stored record.
- `load()` authenticates before returning data and rejects bad data.
- `saveIfAbsent(record)` is atomic. It never overwrites an existing record.
- `clear(expectedDigest)` is an atomic compare-and-delete.

Use a database, Redis, or a platform store that can provide these atomic
operations. A failed save stops the request before the signed credential is
sent.

The buyer clears this slot only after Base proves the exact Economic Effect.
It checks the chain, canonical USDC contract, successful transaction and
canonical block, full `transferWithAuthorization` input, `Transfer` event, and
`AuthorizationUsed` event. This binds payer, recipient, asset, network, amount,
time window, nonce, and transaction. A normal official x402 seller works; it
does not need a 0xkey receipt extension.

For Base mainnet, set `rpcUrls["eip155:8453"]` to a production-grade Base RPC, or
provide an audited `receiptVerifier` with the same checks. The public
`https://mainnet.base.org` endpoint is rejected. Base Sepolia may use its
public endpoint. This check happens when the buyer is created, before it can
sign or send a payment.

`network` is required everywhere; there is no inferred environment and no
Sandbox workspace. The same organization and API-key model can use either
Base mainnet or Base Sepolia, but each SDK instance and every signed credential
belongs to exactly one network. Seller and Admin traffic uses the matching
`/base-mainnet` or `/base-sepolia` channel on the configured canonical API
origin. Production uses `https://api-pay.0xkey.io`; staging uses
`https://api-pay.staging.0xkey.io`. Both canonical origins reject any other URL
shape instead of guessing a network. Pass the exact origin or exact selected
channel string; normalized variants such as credentials, ports, trailing
slashes, queries, fragments, dot segments, or host spelling changes are
rejected.

`pay.0xkey.io` and `pay.staging.0xkey.io` serve the product websites. Neither is
a facilitator base URL.

For tests and local work only, storage can be disabled explicitly:

```ts
const payFetch = createPayFetch({
  account,
  allowHosts: ["localhost:3000"],
  network: "eip155:84532",
  maxAmount: "$0.10",
  allowInMemoryPendingPayment: true,
  allowInsecureLocalhost: true,
});
```

This mode is process-only. A crash can lose the signed request. Do not use it
in production.

### Resume an unknown payment

If a signed request returns any 5xx, including
`503 PAYMENT_STATUS_UNKNOWN`, do not make a new payment. Call `resume()`. It
reuses the saved credential. A normal call is blocked while a payment is
pending. Treat any unexpected 5xx after signing as unknown, even when it is not
the normal structured 503 response.

```ts
const response = await payFetch.resume();
```

After a restart, give the same `pendingPaymentStore` to a new buyer. Its first
call loads the saved request. Call `resume()` to send it again. `resume()` and
normal calls share one in-process lock.

```ts
const payFetch = createPayFetch({
  account,
  allowHosts: ["api.example.com"],
  network: "eip155:8453",
  maxAmount: "$0.10",
  pendingPaymentStore,
  rpcUrls: { "eip155:8453": process.env.BASE_RPC_URL! },
});

const response = await payFetch.resume(); // reuses the original credential
```

`pendingPayment` remains available for manual handoff:

```ts
const pendingPayment = await payFetch.exportPendingPayment();
const restored = createPayFetch({
  account,
  allowHosts: ["api.example.com"],
  network: "eip155:8453",
  maxAmount: "$0.10",
  pendingPayment,
  pendingPaymentStore,
  rpcUrls: { "eip155:8453": process.env.BASE_RPC_URL! },
});
```

It contains a live credential, headers, and body. Never log it. Its
`requestDigest` is only an unkeyed checksum for accidental damage. An attacker
can edit the data and recompute that checksum. Security comes from the store's
AEAD or encryption plus HMAC, with the key kept outside the record.

On restore, the SDK uses mppx schemas to check the payer, Base network,
canonical USDC, amount limit, recipient, and challenge. The authenticated
stored snapshot binds the original URL, method, headers, and body.
Pending-payment format v3 also binds the selected network. Restoring it through
an SDK instance configured for the other network fails before any request is
sent.

## Admin

```ts
import { createPayAdminClient } from "@0xkey-io/pay/admin";

const admin = createPayAdminClient({
  baseUrl: "https://api-pay.0xkey.io",
  network: "eip155:8453",
  organizationId: process.env.ZEROXKEY_ORGANIZATION_ID!,
  apiKey: {
    publicKey: process.env.ZEROXKEY_PUBLIC_KEY!,
    privateKey: process.env.ZEROXKEY_PRIVATE_KEY!,
  },
});

const confirmedMpp = await admin.payments.list({
  status: "CONFIRMED",
  protocol: "mpp",
});
```

Use `@0xkey-io/pay/admin` only in a server or BFF. A browser dashboard must call
a session-authenticated BFF. Never put an API private key or facilitator bearer
token in a browser bundle.

Pay v1 has one interface per job:

- buyer: `createPayFetch`;
- seller: `createPayServer` plus a framework adapter;
- server-side dashboard BFF and operations: `createPayAdminClient`.

The RC has no customer compatibility layer. Old `Pay.client`,
`createPayClient`, paywall helpers, and lowercase payment states are not
exported. The Admin client is fixed to its configured organization. Read calls
cannot supply a different organization ID.

The Admin payment record uses only the new uppercase state machine. It includes
`payer`, `payTo`, the protocol, and trusted digests used to prove what was paid.
It does not add a fixed `direction` field. Shared-relayer balances are internal
operations data and are not exposed by this SDK.

## Keeping docs current

Changes to a protocol, public option, entry point, network, asset, receipt, or
recovery rule must update the matching document in the same pull request.

```bash
pnpm --filter @0xkey-io/pay docs:check
```
