# Migrating the Pay buyer to 1.0

Pay 1.0 intentionally removes the pre-GA callable `createPayFetch()` API. There
is no compatibility wrapper.

Pay 1.0 requires Node.js 22.12 or later. That is the supported baseline for
both ESM imports and CommonJS `require()` of Pay's ESM dependency graph; Node 18
is not a supported CommonJS runtime.

Replace the flat options with explicit policy, recovery, and verification
groups, then call the returned client's `fetch()` method:

```ts
const payments = createPayClient({
  account,
  network: "eip155:8453",
  policy: {
    allowHosts: ["api.example.com"],
    maxAmount: "$0.10",
    preference: ["x402", "mpp"],
  },
  recovery: pendingPaymentStore,
  verification: { rpcUrl: process.env.BASE_RPC_URL! },
});

await payments.fetch("https://api.example.com/weather");
```

The former `allowInMemoryPendingPayment`, `pendingPayment`,
`exportPendingPayment()`, and `hasPendingPayment()` surfaces are removed.
Provide a durable authenticated store in every environment. Use `pending()`
for a redacted status summary and `resume()` to replay the authenticated saved
request.

Pre-1.0 rc.6 records used version 3 without protocol, adapter, or Economic
Effect bindings. They are intentionally rejected with
`PENDING_PAYMENT_VERSION_UNSUPPORTED`. Resolve or discard them through an
explicit operator process before upgrading; the SDK will not upgrade or
re-sign them.

All client failures are `PayError` instances. Branch on `code`, `phase`, and
`retryable`, not message text. A signed 5xx becomes retryable
`PAYMENT_STATUS_UNKNOWN`; call `resume()` and do not create a new payment.

## Seller migration

The former route-table `server.handle()` surface is removed. Create one
protected Fetch handler per route, or pass the same route and handler to an
Express, Hono, or Next adapter:

```ts
const weather = payments.protect(
  { price: "$0.01", description: "Weather" },
  ({ paymentId }) => Response.json({ weather: "sunny", paymentId }),
);
```

Configure enabled protocols once in `createPayServer`; MPP requires a secret of
at least 32 UTF-8 bytes. The seller is always upfront: settlement precedes the
handler. Use the handler's private `paymentId` for idempotency, but never copy it
into x402 objects, MPP credentials, standard receipts, or public headers.

Key-backed constructors now reject malformed or mismatched P-256 credentials
immediately, including MPP-only sellers before an unsigned challenge can be
offered. Use a matching 33-byte compressed public key (`02`/`03` plus 64 hex
characters) and a complete 32-byte private scalar (64 hex characters, non-zero
and below the P-256 group order). Both hex letter cases are accepted; prefixes,
whitespace, and shortened scalars are not. Replace dummy credentials in local
tests with synthetic valid pairs. Failures are redacted `PayError` instances:
`PAY_PROFILE_INVALID`, phase `configuration`, `retryable: false`, and no
`paymentId` or retained crypto cause. Custom `RequestStamper` injection remains
unchanged and does not validate remote credentials; direct adapters still
require exactly one of `apiKey` and `stamper`.

Custom upstream wiring moved to dedicated entries. Use
`create0xkeyFacilitatorClient` from `@0xkey-io/pay/x402` for an official x402
resource server, or `create0xkeyEvmChargeMethod` from `@0xkey-io/pay/mpp` with
`Mppx.create`. The latter is native MPP HTTP only; x402 is a separate seller
path.

Install exactly `mppx@0.8.19`; it is an exact peer because the safe 503 boundary
depends on one shared `PaymentError` class identity. A direct MPP method returns
an actual HTTP 503 Response (without a retry challenge or receipt) when command
settlement is indeterminate, even though mppx's internal method-result
discriminant remains 402. Return `result.challenge` to the framework. Raw mppx
does not persist or replay that credential after 503: callers must save the
original `Authorization` credential and resend those exact bytes, or use
`createPayClient()` for built-in durable recovery.

Keep the complete peer contract installed: `@x402/core@2.23.0`,
`mppx@0.8.19`, and `viem>=2.54.0 <3`. Private settle success now fails closed
unless its exact nested envelope binds the configured network and verified
payer and contains a non-zero transaction hash.

For direct x402 wiring, additionally pass `facilitatorResponseError` from the
same public `@x402/core/server` import as your resource and HTTP server. Ensure
the framework catch shares that actual owner, including its physical package
and module condition. Exact pins do not establish that identity. Omission
retains Pay's imported 2.23 constructor; unconfigured 2.22 and mixed-owner
failures can incorrectly become 402. Do not use `core/http`'s CJS constructor
or a plain `Error` as a substitute. The
[strict public upfront example](./examples/x402-upfront.ts) typechecks against
the exact published 2.22 and 2.23 consumer APIs without casts. Pay's own 2.23
peer is unchanged; a separately locked 2.22 consumer is compatibility evidence,
not permission to install an invalid peer graph.

Native exact-scheme defaults support authorization, not the required upfront
flow. Use the example's public EIP-3009/upfront registration and the official
framework's `*FromHTTPServer` adapter, without a verification hook. With the
correct owner, dependency/UNKNOWN failures return 502, no challenge or receipt,
and no paid handler. On success, the framework echoes the before-handler
settlement rather than settling twice. See [tested boundaries](./direct-x402.md).
Raw official buyers still own durable same-credential recovery after 5xx;
changing the error owner does not add storage, retries, or a recovery service.

These two x402 server integrations intentionally use different private 0xkey
request bodies. The public `create0xkeyFacilitatorClient()` preserves the
official facilitator envelope (`organizationId`, `x402Version`,
`paymentPayload`, and `paymentRequirements`). The 0xkey-owned
`createPayServer().protect()` path verifies that envelope, converts the verified
economic effect to a `ChargeSettlementCommand`, and sends it to the distinct
`/v1/settlements/charge` path with
`{ organizationId, command }`. Neither private body is part of an x402 receipt
or a root package export.
