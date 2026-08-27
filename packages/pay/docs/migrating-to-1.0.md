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

Unknown callback/dependency failures cannot select a code by message, name or
lookalike fields. They use `PAYMENT_SERVICE_UNAVAILABLE` (retryable) in the
calling operation's phase: `request` for `fetch`, `recovery` for `pending` and
`resume`. Unknown construction failures caught by the configuration boundary
use `PAY_PROFILE_INVALID` (`configuration`, not retryable). Messages are fixed
safe text, with the original thrown value retained as `cause`. A `PayError`
from the same local module owner retains its identity; a foreign copy does not.
The signer and receipt-verifier boundaries still wrap any exception as
`PAYMENT_SIGNING_FAILED` and `PAYMENT_RECEIPT_UNVERIFIED`, respectively. The
verifier's original exception is now the direct typed error's `cause`, without
the former intermediate marker error.
If an upstream protocol replaces that typed error with an ordinary error
(as the pinned x402 fetch client does for signing failures), the public result
uses the operation fallback and retains the upstream error as its cause.

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

Install exactly `mppx@0.8.19` for Pay's peer contract. For direct wiring pass
`paymentError: Errors.PaymentError` from the same physical public `mppx` module
as your `Mppx.create()` owner. Omission keeps the SDK-resolved constructor;
matching versions alone do not establish ownership. The
[typed recipe](./examples/mpp-upfront.ts) accepts the pinned native 0.8.19 and
0.8.17 constructors without casts. Separate 0.8.17 owner/wire compatibility
does not relax Pay's exact peer or approve a peer-invalid downgrade.

The option is captured and probed synchronously with synthetic public values,
before payment I/O. Nonconstructible, throwing or incompatible configuration
fails as redacted `PAY_PROFILE_INVALID` (`configuration`, not retryable, no
`paymentId` or retained constructor cause). It never silently falls back.
Shape validation cannot verify the owner of a separately created Mppx;
supplying a structurally valid wrong owner remains an integration-profile
error. Arbitrary constructors and cross-realm behavior are not supported.
Settlement Problem Details now expose only `errorCode` and `retryable` in
`details`; incidental private `paymentId` data is no longer forwarded.

A direct MPP method returns
an actual HTTP 503 Response (without a retry challenge or receipt) when command
settlement is indeterminate, even though mppx's internal method-result
discriminant remains 402. Return `result.challenge` to the framework. Raw mppx
does not persist or replay that credential after 503: callers must save the
original `Authorization` credential and resend those exact bytes, or use
`createPayClient()` for built-in durable recovery.

Both direct MPP receipt wrapping and the protected facade now emit receipts
only on 2xx, stripping even handler-supplied receipts on every non-2xx status.
Status, status text, body stream, Location and unrelated headers are preserved,
as is each path's existing cache policy. Fulfillment classification is unchanged:
handler throw/5xx means `FAILED`; other returned statuses mean `FULFILLED`.
`FULFILLED` does not prove an application side effect. In particular, 3xx/4xx
have no MPP receipt and cannot clear buyer pending. Persistence failure keeps
the existing 503/no-receipt behavior, with no new challenge or settlement.

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
