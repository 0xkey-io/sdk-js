# Direct official x402 integration

The dedicated `@0xkey-io/pay/x402` entry returns the official three-method
`FacilitatorClient`. Its private `/supported`, `/verify`, and `/settle` calls
keep the existing X-Stamp and facilitator-envelope contract. This is distinct
from the 0xkey-owned seller facade and its settlement-command endpoint.

## One consumer-owned error boundary

```ts
import { FacilitatorResponseError, x402ResourceServer } from "@x402/core/server";
import { create0xkeyFacilitatorClient } from "@0xkey-io/pay/x402";

const facilitator = create0xkeyFacilitatorClient({
  network: "eip155:84532",
  organizationId,
  apiKey,
  facilitatorResponseError: FacilitatorResponseError,
});
const resource = new x402ResourceServer(facilitator);
```

The constructor must come from the same actual public `core/server` module
that owns the consumer's resource server, HTTP server, and framework catch.
The option is `new (message: string) => Error`, for the official constructor;
it is not a general error mapper or behavior-changing factory. Capture occurs
at construction, so later mutation of the option does not change it.

Omission uses Pay's imported `@x402/core@2.23.0` server constructor. Native
same-owner CJS and ESM work. A version pin alone does not guarantee identity:
unconfigured 2.22, separate physical copies, mixed CJS/ESM conditions, and the
CJS `core/http` constructor can turn dependency errors into an incorrect 402.
Use explicit configuration and test the actual deployment error path. A valid
but wrong-owner constructor (including plain `Error`) passes structural
validation and is still an invalid integration profile. There is no arbitrary
foreign-realm guarantee.

Nonconstructible values, a throwing constructor, a non-Error result, or an
instance unable to accept the nonenumerable cause fail synchronously with
redacted `PAY_PROFILE_INVALID`, phase `configuration`, `retryable: false`, no
`paymentId`, and no retained constructor cause, before any stamp or I/O. There
is no fallback after an explicit invalid value. The probe constructs one error
with a fixed safe message. Real errors likewise receive exactly one fixed safe
message; only SDK code attaches the original `PayError` as nonenumerable cause.
Caller-supplied executable constructor behavior remains the caller's responsibility.

## Natural EIP-3009 upfront composition

Use the complete [public TypeScript recipe](./examples/x402-upfront.ts) and the
[official framework composition](./examples/x402-frameworks.ts). They accept
the published 2.22.0 and 2.23.0 APIs without casts. The recipe delegates official
`ExactEvmScheme` methods through a public structural `SchemeNetworkServer`
registration specifying only EIP-3009/upfront. Native defaults advertise
authorization-only and reject an upfront route; direct facilitator replacement
alone is not sufficient. No unsafe verification hook is used.

For this upfront route, official request processing settles before the paid
handler. Framework success processing echoes `beforeHandlerSettlement` without
a second settle. Supported failures never supply a default capability.
Dependency and UNKNOWN failures in the tested graphs return 502, no new
`PAYMENT-REQUIRED`, no fabricated `PAYMENT-RESPONSE`, and no handler. A
deterministic invalid settlement remains a distinct 402 with the upstream
failed-settlement receipt. Direct `verify` is independently fault-tested; the
natural upfront route deliberately does not call it.

## Bounded compatibility evidence

- Exact consumer `@x402/{core,evm,express,hono,next}` 2.22.0 and 2.23.0;
  Pay retains its exact core/evm/fetch 2.23.0 and mppx 0.8.19 dependencies/peers.
  The 2.22 consumer is separately locked, with its own physical error owner.
- Express 5.2.1 and Hono 4.12.5 native CJS/ESM fixtures; a separate peer-clean
  combined current graph uses Hono 4.12.25 to satisfy mppx's optional peer.
  The frozen 4.12.5 peer-conflict negative is retained, not widened away.
- Next 16.2.6 / React 19.2.4: native CJS request dispatch and strict TypeScript
  production build/start routes. Native Node ESM import of the published
  official Next adapter fails resolving `next/server` before Pay runs; a
  successful build is a separate tested bundler path, not a resolver patch.
  This does not certify the product workspace's Next 16.1.6.
- Native pure current owner, explicitly configured 2.22, and mixed-condition
  graphs preserve the consumer error. Wrong version, physical owner, CJS
  subpath, omitted incompatible owner, and plain-Error negatives retain their
  observed incorrect-402 outcome; they are not advertised supported profiles.

These local fixtures use a checked npm tar, actual official middleware, fixed
synthetic data, and bounded offline execution. They are not a complete native
bidirectional conformance matrix, real chain settlement, or GA approval.

## Recovery remains a buyer responsibility

The seam adds no retry or storage behavior. In particular, it does not change
the existing bounded `/supported` 429 retry; 503, timeout, malformed response,
and settle UNKNOWN tests make one private attempt. Raw official buyers must
persist and resend the original credential after an unresolved result, or use
`createPayClient()` with an authenticated durable store and externally retained
store key. Never sign a replacement, change protocol/provider/network, or clear
pending state merely because the merchant returns 200.

Selected configured 2.22 and current paths have synthetic loopback HTTPS
challenge/sign/send and fresh-process recovery evidence. UNKNOWN keeps pending
and blocks the handler. A syntactically malformed receipt currently produces
`PAYMENT_SERVICE_UNAVAILABLE`; a decoded wrong-network receipt produces
`PAYMENT_RECEIPT_MISMATCH`; failed RPC proof produces
`PAYMENT_RECEIPT_UNVERIFIED`. All retain the same authenticated record. Only the
default verifier's full Economic Effect proof permits compare-and-delete.
Repeated same-credential backend requests are not duplicate economic broadcasts.
Successful same-credential retries can nevertheless reenter the paid handler.
The response-only framework example has no business side effects; direct
consumers own business-operation deduplication. The standard facilitator does
not expose the private `paymentId`. Use the 0xkey-owned `protect()` facade when
you need `paymentId`-based handler context for idempotent business writes.
See [the full recovery contract](./protocol-selection-and-recovery.md).
