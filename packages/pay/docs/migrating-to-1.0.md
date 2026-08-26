# Migrating the Pay buyer to 1.0

Pay 1.0 intentionally removes the pre-GA callable `createPayFetch()` API. There
is no compatibility wrapper.

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

Custom upstream wiring moved to dedicated entries. Use
`create0xkeyFacilitatorClient` from `@0xkey-io/pay/x402` for an official x402
resource server, or `create0xkeyEvmChargeMethod` from `@0xkey-io/pay/mpp` with
`Mppx.create`. The latter is native MPP HTTP only; x402 is a separate seller
path.
