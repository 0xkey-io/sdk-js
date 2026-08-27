# @0xkey-io/pay

Buyer and seller SDK for x402 v2 `exact` and MPP `evm/charge`.

Runtime support starts at Node.js 22.12 for both ESM imports and CommonJS
`require()`.

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

app.get(
  "/weather",
  paymentMiddleware(
    payments,
    { price: "$0.01", description: "Weather" },
    (_request, payment) =>
      Response.json({ weather: "sunny", paymentId: payment.paymentId }),
  ),
);
```

The same core has `@0xkey-io/pay/hono` and `@0xkey-io/pay/next` adapters.
The handler receives `paymentId`. Use it as the idempotency key for writes.

Key-backed Seller and direct x402/MPP adapters validate `apiKey`
synchronously at construction, before any payment offer or API request. Supply
a matching P-256 pair: `publicKey` is 33-byte compressed hex (66 characters,
`02` or `03` prefix); `privateKey` is a 32-byte scalar encoded as 64 hex
characters, with value greater than zero and below the P-256 group order.
Uppercase and lowercase hex are accepted without changing the supplied object;
`0x` prefixes and whitespace are not accepted. The validated key values are
copied for subsequent stamps, so later caller mutations cannot change the
signing identity. Invalid or missing material
throws `PayError` with code `PAY_PROFILE_INVALID`, phase `configuration`,
`retryable: false`, and no `paymentId` or key-bearing cause. This local check
does not prove remote admission or API authorization. Direct adapters still
accept exactly one of `apiKey` or a custom `RequestStamper`; custom stampers
are not probed or locally credential-validated.

`protect()` verifies and settles before the handler. It reports every returned
status below 500 as `FULFILLED` through the private signed fulfillment endpoint
and every throw or 5xx as `FAILED`. This classification does not prove an
application side effect. MPP receipts are eligible only on 2xx responses:
3xx/4xx remain `FULFILLED` but have no receipt and cannot clear buyer pending.
All non-2xx responses also discard a handler-supplied MPP receipt. x402 uses
the unchanged official upfront failure-path receipt. A persistence timeout or
non-200 response becomes retryable `PAYMENT_STATUS_UNKNOWN`, so a retry or
restart reuses the same credential and `paymentId`.

For direct upstream integration, `@0xkey-io/pay/x402` returns an official
`FacilitatorClient`, while `@0xkey-io/pay/mpp` returns a native-only mppx EVM
charge method. These dedicated entries own upstream wire types; root, client,
and server declarations do not expose them.

One selected malformed MPP credential (including invalid encoding or unknown
raw fields) returns native mppx `402`, a fresh `WWW-Authenticate: Payment`
challenge, and `malformed-credential` Problem Details before settlement. It
never returns a payment receipt. Dual credential ambiguity and a credential
for a disabled protocol remain `400`; settlement dependency/UNKNOWN responses
remain non-402 without a fresh challenge. A buyer with a saved credential must
not sign a replacement even when it receives a fresh challenge.

For direct x402 integration, pass `facilitatorResponseError:
FacilitatorResponseError`, imported from the same public `@x402/core/server`
module that owns the consumer's resource/HTTP server and framework catch.
Dependency and indeterminate settlement failures then remain that owner's
official error, with the original retryable `PayError` as a nonenumerable
`cause`; the tested official middleware returns 502 without a new challenge
or paid handler. Omission uses Pay's imported 2.23 constructor. Exact versions
alone do not ensure one owner: unconfigured 2.22, duplicate physical packages,
mixed CJS/ESM conditions, and the CJS `core/http` subpath can lose the exception
and produce an incorrect 402. See the
[public upfront recipe and tested boundaries](./docs/direct-x402.md).

The package retains the peer contract `mppx@0.8.19`, `@x402/core@2.23.0`,
and `viem>=2.54.0 <3`. The Viem peer supplies the public runtime signer/address
dependency. For direct MPP composition, pass `paymentError: Errors.PaymentError`
from the same physical `mppx` module used by your `Mppx.create()`; see the
[typed public recipe](./docs/examples/mpp-upfront.ts). Omission uses Pay's
SDK-resolved constructor. Exact versions do not guarantee physical ownership.
The supported constructor contract is the pinned native 0.8.19/0.8.17 classes,
not arbitrary executable configuration or cross-realm plugins; the package's
exact 0.8.19 peer is unchanged. A separate 0.8.17 owner/wire composition is not
a peer-clean downgrade claim. The constructor is captured and its safe Problem
Details contract validated synchronously before payment I/O. Invalid
configuration throws redacted `PAY_PROFILE_INVALID` (`configuration`, not
retryable, no `paymentId` or constructor cause), with no fallback. Shape
validation cannot prove the owner of a separately created Mppx instance: a
valid but wrong physical constructor is an integration-profile error, not a
promised early rejection. Only `errorCode` and `retryable` appear in settlement
Problem Details extensions; private `paymentId` and causes stay internal.
With raw
`Mppx.create({ methods: [method] })`, a post-send indeterminate settlement has
an internal mppx result discriminant of 402, but its returned HTTP `challenge`
Response is 503 with `Retry-After: 2`, no `WWW-Authenticate`, and no receipt.
Return that Response as normal; do not inspect only the internal discriminant.
The official mppx client does not durably recover a 503. Capture and persist the
original `Authorization: Payment ...` credential before its first send, then
retry the same credential after reconciliation. Never create a new credential
for that unresolved economic effect. `createPayClient()` already implements
this durable same-credential recovery contract.

The direct x402 client keeps the official private `/verify` and `/settle`
envelope. Both private settle decoders require exact keys, the configured
network, a matching verified payer and non-zero transaction on success, and
strictly typed optional fields. The 0xkey seller facade independently validates
that wire, derives a
closed `ChargeSettlementCommand`, and sends seller x402 and MPP commands only
to `/v1/settlements/charge`; `paymentId` remains outside standard receipts.

## Buyer

```ts
import { createPayClient } from "@0xkey-io/pay/client";

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

const response = await payments.fetch("https://api.example.com/weather");
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

`recovery` is required. It is one durable slot for one
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

For Base mainnet, set `verification.rpcUrl` to a production-grade Base RPC, or
provide an audited `verification.verifier` with the same checks. The public
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

There is no implicit or in-memory production mode. Tests may provide a test
store, but every client instance uses the same atomic durable-store contract.

### Resume an unknown payment

If a signed request returns any 5xx, including
`503 PAYMENT_STATUS_UNKNOWN`, the client throws a retryable `PayError` with
code `PAYMENT_STATUS_UNKNOWN` and keeps the saved request. Call `resume()`; it
reuses the same credential bytes. A normal call is blocked while a payment is
pending.

```ts
const response = await payments.resume();
```

After a restart, give the same recovery store to a new buyer. Its first
call loads the saved request. Call `resume()` to send it again. `resume()` and
normal calls share one in-process lock.

```ts
const payments = createPayClient({
  account,
  network: "eip155:8453",
  policy: { allowHosts: ["api.example.com"], maxAmount: "$0.10" },
  recovery: pendingPaymentStore,
  verification: { rpcUrl: process.env.BASE_RPC_URL! },
});

const response = await payments.resume(); // reuses the original credential
```

Use `pending()` for safe operational inspection:

```ts
const pending = await payments.pending();
```

The summary contains only the request digest, protocol alias and stable
protocol id, network, URL, and method. It never returns headers, body,
credential, receipt, or the complete Economic Effect. The encrypted store owns
the full version-3 record; do not log or manually move its plaintext.

On restore, the SDK uses mppx schemas to check the payer, Base network,
canonical USDC, amount limit, recipient, and challenge. The authenticated
stored snapshot binds the original URL, method, headers, and body.
Pending-payment format v3 binds the selected network, stable protocol id,
literal adapter revision `pay-client-v1`, Economic Effect digest, URL, method,
headers, and body. An rc.6 version-3 record lacks these new bindings and fails
with `PENDING_PAYMENT_VERSION_UNSUPPORTED`; it is never upgraded or re-signed.

See [the 1.0 migration guide](./docs/migrating-to-1.0.md) for the intentional
pre-GA API break.

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

- buyer: `createPayClient`;
- seller: `createPayServer` plus a framework adapter;
- server-side dashboard BFF and operations: `createPayAdminClient`.

The RC has no customer compatibility layer. Old `Pay.client`,
`createPayFetch`, paywall helpers, and lowercase payment states are not
exported. The Admin client is fixed to its configured organization. Read calls
cannot supply a different organization ID.

The Admin payment record uses only the new uppercase state machine. It includes
`payer`, `payTo`, the protocol, and trusted digests used to prove what was paid.
It does not add a fixed `direction` field. Shared-relayer balances are internal
operations data and are not exposed by this SDK.

## Release source integrity

The dedicated RC publisher binds the requested source, checkout, current
default branch, GitHub run, and executing workflow to one exact commit before
builds and immediately before publishing. Only a direct same-repository
default-branch dispatch is accepted; stale reruns must use a fresh dispatch.
The source stays private and only the checked tarball may be published to
`next`. See [release guidance](../../RELEASING.md#pay-release-candidates).
Local guard tests are not publication or signed-provenance evidence; actual
npm evidence and verifier compatibility remain external release gates.

Before publishing, the workflow preserves the original checked tarball and
source/run context. After publication and tag checks it captures a six-file
registry observation receipt, preserving the exact nested bundle bytes without
reserializing them. A capture failure is recovered read-only from the original
tar/context, never by republishing or rebuilding a substitute. Both Actions
uploads expire after 90 days; an owner-approved durable export/access policy is
required before GA. See the [npm evidence contract](./docs/npm-publication-evidence.md).
All collected provenance fields remain **unverified** until the independent
release verifier applies approved trust inputs and signature policy.

## Keeping docs current

The private repository harness at `internal/pay-conformance` is currently at
checkpoint 7A: frozen fixture inputs, process/report safety, and an explicit
145-row inventory. It does not yet execute protocol conformance. Run
`pnpm --filter @0xkey-io/pay test:conformance --output /absolute/new-report.json`
with a new output path outside the checkout. It writes an immutable
`not_approved` report and exits nonzero: 142 rows are `BLOCKED`, with three
source-backed `NOT_APPLICABLE` capability boundaries. Foundation unit tests,
dependency installation, and previous readiness probes are not matrix passes.
The harness is private and excluded from the Pay package; this command is for
repository maintainers, not installed-package consumers.

Changes to a protocol, public option, entry point, network, asset, receipt, or
recovery rule must update the matching document in the same pull request.

```bash
pnpm --filter @0xkey-io/pay docs:check
```
