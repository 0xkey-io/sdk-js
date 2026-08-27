# Task 3 report — Pay 1.0 server and protocol adapters

Status: **DONE**

Implementation commit: `b95ada0a2` (`feat(pay): add GA server protocol adapters`)

Review-round implementation commit: `d11452f56` (`fix(pay): close GA protocol adapter review`)

Reviewed base: `7811fec0fe79c7c9cf5ef2965f6dc8ad5a32c116`

## Outcome

Task 3 is implemented in the isolated `sdk-js` worktree. The package now has
separate `@0xkey-io/pay/x402` and `@0xkey-io/pay/mpp` entries, 0xkey-owned
economic command adapters, an upfront `protect()` seller facade, private signed
fulfillment persistence, thin framework adapters, exact dependency pins,
updated documentation/examples, interoperability evidence, and independent
packed-install evidence.

No publish, push, deploy, service, web, or infrastructure mutation was made.

## RED/GREEN evidence

All runtime boundaries were developed test-first. The commands and observed
results below are the focused evidence retained during implementation.

### Public x402 client and exact transport

- RED: `pnpm exec jest --runInBand src/x402/index.test.ts`
  - failed because `src/x402/index` did not exist.
- GREEN: same command
  - 5 tests passed for official `FacilitatorClient` assignment, exact signed
    verify/settle/supported envelopes, input immutability, response validation,
    private `paymentId` stripping, config validation, safe errors, no
    verify/settle retry, and supported-only 429 retry.
- RED: same command after adding the stamping-failure case
  - 5 passed, 1 failed; received raw `secret signing backend detail` rather than
    `PAYMENT_SERVICE_UNAVAILABLE`.
- GREEN: same command after moving stamping inside the safe transport boundary
  - 6 passed. The test also constructs an official `x402ResourceServer` and
    `x402HTTPResourceServer` from the returned client without casts.

### Public native MPP method

- RED: `pnpm exec tsx --test src/mpp/index.node.test.ts`
  - failed because `src/mpp/index.ts` did not exist (after correcting an initial
    Jest/ESM runner mismatch to the Node/tsx runner).
- GREEN: same command
  - 2 tests passed: the real method is accepted by `Mppx.create`, emits a native
    `WWW-Authenticate: Payment` challenge only, and validates seller config.

### Seller facade and real credentials

- RED: `pnpm exec tsx --test src/server.node.test.ts`
  - failed because the old server had no `protect()` facade and still used the
    former conditional MPP behavior.
- GREEN: same command at the first facade boundary
  - dual independent challenges, ambiguous/disabled dispatch, x402 upfront
    ordering, and initial MPP handling passed.
- RED: same command after changing a real valid MPP credential to
  `Bearer application-token, pAyMeNt <credential>`
  - expected 200, received 400.
- GREEN: same command after reusing `Credential.extractPaymentScheme` and
  canonicalizing only the request passed into mppx
  - all server cases passed. The merchant handler still receives the original
    request.
- RED: the real-credential negative loop initially allowed the credential with
  an unknown raw challenge extension to reach the handler.
- GREEN: after raw-wire extension validation, malformed, expired, wrong
  amount/payTo/network/asset, Permit2, and unknown-extension inputs all fail
  before settlement.
- GREEN: concurrent replay with the same transaction/reference returned two
  distinct request-local `paymentId` values to the matching handlers. There is
  no cross-request reference-to-payment map.
- GREEN: real x402 and MPP credentials prove settlement precedes the handler;
  handler throw/5xx, fulfillment 503, and process-restart replay are covered.

### Framework delegation

- RED: `pnpm exec jest --runInBand src/frameworks.test.ts`
  - old Express/Hono/Next adapters depended on `server.handle()` and duplicated
    receipt/failure behavior.
- GREEN: same command
  - 3 adapters delegate payment behavior only to `protect()`.
- RED: same command after asserting Next route context identity
  - received `undefined` instead of the framework context.
- GREEN: same command after binding the context per request
  - 3 passed.

### Official MPP validator compatibility

- RED: `node scripts/mppx-validate-smoke.mjs`
  - official challenge validation passed 16 checks, but the validator's real
    valid credential received HTTP 400 and no receipt.
- Evidence: key-shape-only inspection showed pinned mppx 0.8.19 emits the
  standard optional challenge `description` field.
- GREEN: after adding only `description` to the challenge allowlist,
  `node scripts/mppx-validate-smoke.mjs`
  - `mppx 0.8.19 validate: 0xkey MPP server passed`.

### Artifact boundary

- RED: `pnpm run artifact:check`
  - the first packed external project exposed a CJS/ESM declaration mismatch
    for the MPP upstream type and mppx's unrelated optional MCP peer declaration.
- GREEN: dedicated upstream-facing entries now originate as `.mts` and publish
  `.d.mts`; the external type smoke skips only dependency-library checking while
  compiling all 0xkey public uses. `pnpm run artifact:check` then passed after
  installing the actual tarball in a fresh project.
- The checker imports root, client, server, x402, mpp, admin, Express, Hono and
  Next in ESM and CJS; compiles their public TypeScript imports; rejects
  `workspace:*`; and rejects upstream wire imports in root/client/server
  declarations.

### Changes-requested review round

- RED: `pnpm --filter @0xkey-io/pay exec jest --runInBand src/internal/x402-exact-v2-adapter.test.ts src/frameworks.test.ts src/x402/index.test.ts`
  - 11 failures: x402 accepted/payload unknown keys passed, framework adapters
    rebuilt `protect()` and Express emitted no binary chunks, signed fetches did
    not set `redirect: "error"`, and HTTP-date retry happened immediately.
- GREEN: the same command
  - 25 tests passed after exact x402 key guards, route-level framework caching,
    request-local framework context maps, Express stream/backpressure bridging,
    redirect refusal, and delta/HTTP-date/clamped Retry-After parsing.
- RED: `pnpm --filter @0xkey-io/pay exec tsx --test src/server.node.test.ts`
  - valid x402 settle failure was reissued as 402, verify dependency failure
    reached settlement, seller x402 still sent the official settlement envelope,
    and MPP accepted an unknown raw payload key.
- GREEN: the same command
  - 6 server cases passed. Real valid x402 credentials now produce stable outer
    502 for private verify unavailability and 503 `PAYMENT_STATUS_UNKNOWN` for
    settle 5xx/redirect, with no handler and no replacement challenge. Real
    valid MPP credentials produce 503 for settle 5xx/network failure; captured
    mppx logging contains no injected secret. Wire failures settle and handle
    zero times. Route discovery success or failure calls `/supported` once.
- RED: `pnpm --filter @0xkey-io/pay exec jest --runInBand src/x402/index.test.ts`
  - past HTTP-date Retry-After timed out because it incorrectly fell back to a
    one-second exponential delay.
- GREEN: the same command
  - 11 tests passed; delta, future/past HTTP-date and the 30-second upper clamp
    are covered.
- RED: `pnpm --filter @0xkey-io/pay exec jest --runInBand src/internal/zeroxkey-settlement-adapter.test.ts`
  - 4 failures against the frozen Task 4 command-contract addendum: command
    traffic used `/settle`, the caller selected wireProtocol, mismatched
    protocol/revision reached stamping, and flattened success was accepted.
- GREEN: the same command
  - 6 tests passed. Seller commands use only `/v1/settlements/charge`, derive
    `x402|mpp` from the exact closed protocol/revision pair, reject mismatch
    before stamping, require strict nested `{settlement,paymentId}`, reject
    private standard-object keys, and bind response network/payer to the
    command. The independent public x402 client remains on official
    `/verify|/settle` envelope calls.
- RED: the x402 adapter focused command after adding top-level extension and
  resource-private-key cases
  - 2 failures; both inputs reached command construction.
- GREEN: the same command
  - 11 tests passed after exact top-level/resource allowlists.
- RED: `node --test packages/pay/scripts/check-packed-artifact.test.mjs`
  - the new Node baseline fixture reached missing-artifact validation instead
    of rejecting the `>=18.0.0` engine.
- GREEN: `pnpm --filter @0xkey-io/pay exec node --test scripts/check-packed-artifact.test.mjs`
  - 5 tests passed, including exact `>=22.12.0` manifest enforcement.

## Files and public surface

### Runtime and adapters

- `packages/pay/src/server.ts`
- `packages/pay/src/server/index.ts`
- `packages/pay/src/x402/index.mts`
- `packages/pay/src/mpp/index.mts`
- `packages/pay/src/internal/charge-settlement-command.ts`
- `packages/pay/src/internal/create-mpp-evm-charge-method.ts`
- `packages/pay/src/internal/x402-facilitator.ts`
- `packages/pay/src/internal/x402-exact-v2-adapter.ts`
- `packages/pay/src/internal/mpp-evm-charge-adapter.ts`
- `packages/pay/src/internal/zeroxkey-settlement-adapter.ts`
- `packages/pay/src/express/index.ts`
- `packages/pay/src/hono/index.ts`
- `packages/pay/src/next/index.ts`

### Tests and smoke evidence

- `packages/pay/src/x402/index.test.ts`
- `packages/pay/src/mpp/index.node.test.ts`
- `packages/pay/src/server.node.test.ts`
- `packages/pay/src/internal/x402-exact-v2-adapter.test.ts`
- `packages/pay/src/internal/zeroxkey-settlement-adapter.test.ts`
- `packages/pay/src/frameworks.test.ts`
- `packages/pay/scripts/interop-smoke.mjs`
- `packages/pay/scripts/mppx-validate-smoke.mjs`
- `packages/pay/scripts/check-packed-artifact.mjs`

### Packaging, documentation and example migration

- `packages/pay/package.json`, `rollup.config.mjs`, Pay tsconfig/Jest config,
  exact-pin checker, and `pnpm-lock.yaml`
- Pay README, changelog, generated support, protocol/recovery contract, and 1.0
  migration guide
- `examples/pay-v1-uat` seller facade, challenge smoke, and mppx 0.8.19 pin
- contract-guard package-surface baseline

## API and interoperability decisions

1. **x402 stays official at the public seam.**
   `create0xkeyFacilitatorClient` returns the exact official structural client.
   The custom transport exists only because X-Stamp signs the exact private
   body. Public settle reconstructs the standard response and never exposes the
   private id.

2. **Private settlement state is request-local.**
   Both protocol paths construct a request-scoped upstream server/method with a
   synchronous private-result closure. This is narrower than a reference-keyed
   map and cannot cross-wire concurrent duplicate references or retain private
   metadata after the request.

3. **Published x402 2.23.0 differs from its pinned source snapshot.**
   The pinned source declares EIP-3009 `authorization` and `upfront`; the npm
   2.23.0 runtime declaration exposes only `authorization`. The seller uses an
   official `ExactEvmScheme` instance, narrows its `paymentFlows` instance to
   match the pinned source, and uses the official resource-server
   `onBeforeVerify` hook to call the official facilitator verify before the
   official upfront settlement path. No forked x402 wire codec was introduced.

4. **MPP is native-only without casting wires.**
   mppx 0.8.19's EVM charge constructor composes transports. Its public
   `Method.Server` transport seam is replaced with official `Transport.http()`;
   validation and receipt generation remain owned by mppx. The official
   `Credential` and `Receipt` APIs are used for extraction/decoding.

5. **Declarations isolate upstream types.**
   Root/client/server declarations contain no `mppx` or `@x402/*` imports.
   Dedicated `.d.mts` entries are used because both upstream packages are ESM;
   this also keeps the bundled CJS runtime importable.

6. **Fulfillment fails closed.**
   Signing, fetch, and response consumption all sit inside the safe boundary.
   Only HTTP 200 commits. A failure produces stable unknown recovery behavior,
   never exception text, bodies, credentials, receipts, or a new signature.

7. **Indeterminate protocol work cannot become a new 402.**
   x402 uses explicit hook abort/skip results and a request-local failure
   channel around upstream 2.23 exception swallowing. MPP converts the local
   original classification to a sanitized mppx `PaymentError`. Both override
   upstream retry challenges with stable 502/503 responses before any handler.

8. **Seller command transport is distinct from official x402.**
   `create0xkeyFacilitatorClient()` continues to send the official private
   envelope to `/verify|/settle`. `protect()` sends validated x402/MPP economic
   commands only to `/v1/settlements/charge`; the adapter, not its caller,
   derives X-Stamp wireProtocol. Only nested private settlement responses are
   accepted.

9. **Node/CJS support is explicit.**
   Package engines, migration docs, generated support and the fresh-install
   artifact checker use Node `>=22.12.0`, the LTS baseline supporting
   `require(ESM)`. No Node 18 CommonJS claim remains.

## Self-review

### Standards axis

- Exact pins and lockfile agree; no ranges were added.
- The dependency-free command imports no upstream protocol.
- Each economic adapter imports only its matching protocol; no MPP-to-x402
  cast, `as any`, provider heuristic, nonce heuristic, or error-English fallback
  remains.
- `paymentId` appears only in private transport results, the request-local
  handler context, and the private fulfillment URL/body flow. Standard x402 and
  MPP decoders see no private id.
- Framework adapters do not parse credentials, select protocols, settle, or
  construct receipts.
- No unrelated dirty-worktree change was overwritten.

### Specification axis

- Every emitted x402 requirement is exact EIP-3009 upfront.
- Dispatch is header-first and fails closed for dual/disabled credentials.
- Verify/settle/handler order, native MPP, private fulfillment, handler failure,
  restart recovery, negative economic cases, concurrency, official injection,
  and packed public imports are exercised.
- README, recovery/migration docs, generated facts, UAT example, interop smoke,
  and package-surface baseline match the new public surface.

## Final verification

The final implementation gate chain (after the last runtime edits) produced:

- `pnpm --filter @0xkey-io/pay test:pay-v1`
  - PASS: 7 Jest suites / 93 tests; Node tests 8/8.
- `pnpm --filter @0xkey-io/pay typecheck:pay-v1`
  - PASS.
- `pnpm --filter @0xkey-io/pay build`
  - PASS, ESM and CJS entries emitted.
- `pnpm --filter @0xkey-io/pay docs:check`
  - PASS after implementation commit; generated support unchanged.
- `pnpm --filter @0xkey-io/pay pins:check`
  - PASS: exact pins.
- `pnpm --filter @0xkey-io/pay test:interop`
  - PASS: official x402 + native MPP across Base mainnet/Sepolia; official
    mppx 0.8.19 validator passed.
- `pnpm --filter @0xkey-io/pay artifact:check`
  - PASS: packed, verified, fresh-installed, ESM/CJS imported, and public types
    compiled.
- `pnpm --filter @0xkey-io/contract-guard audit:exports`
  - PASS (unbuilt unrelated packages were reported as skips by the existing
    guard behavior).
- `pnpm --filter @0xkey-io/contract-guard audit:declarations`
  - PASS (same unrelated-package skips).
- `git diff --check`
  - PASS.

Additional evidence:

- `pnpm --filter pay-v1-uat typecheck` — PASS.
- `pnpm --filter pay-v1-uat smoke` — PASS (`pay_v1_uat_smoke_passed`).
- `pnpm --filter @0xkey-io/contract-guard audit:surfaces` — PASS, 23 packages.

## Concerns and excluded claims

- The private command settlement envelope and fulfillment PUT are SDK-side
  contracts in this task. The SDK is aligned to the frozen Task 4 addendum,
  including the versioned command path and strict response, but services
  implement and independently validate them in later tasks. This report does
  **not** claim deployed end-to-end conformance.
- The x402 npm/source upfront discrepancy is contained and tested, but should be
  removed when a published upstream release exposes the pinned source behavior
  directly.
- The packed TypeScript smoke uses `skipLibCheck` only because mppx's server
  declaration references its optional MCP peer even when the EVM-only path is
  used. The 0xkey declarations themselves are compiled and separately audited.

## Independent re-review closure (2026-08-27)

This section supersedes the earlier final counts and records the second
independent review fixes. The public factory names remain unchanged. Two exact
peer contracts were added because both upstream failure seams use class
identity: `mppx@0.8.19` for `Errors.PaymentError` and `@x402/core@2.23.0` for
`FacilitatorResponseError`. Both are also exact dev dependencies. The packed
fresh npm consumer proves one physical installation of each class owner.

### Upstream API decisions and source evidence

- Frozen mppx 0.8.19 `Mppx.ts:1450-1477` preserves an error only when it is an
  `instanceof Errors.PaymentError`; its raw result union at `Mppx.ts:2311-2319`
  remains `200 | 402`.
- `Errors.ts:14-45` allows a `PaymentError` subclass to set an HTTP status, and
  `Transport.ts:159-210` uses that status for the actual challenge `Response`.
  The official Express/Hono/Next middleware returns that Response directly.
  Therefore `create0xkeyEvmChargeMethod()` truthfully remains a normal Method:
  raw `MethodFn.Response.status` is still the upstream 402 discriminant, while
  the actual official HTTP/framework response is 503 for an indeterminate
  post-send outcome. No fake success or receipt is created.
- Only the private `SettlementBoundaryError` non-402 path removes
  `WWW-Authenticate` and adds `Retry-After`; ordinary mppx transport output,
  including non-boundary errors and HTML/service-worker responses, is returned
  unchanged. Deterministic `success:false` remains the native 402 result.
- Frozen x402 2.23.0 resource/middleware code recognizes
  `FacilitatorResponseError` by class identity and maps it outside the normal
  settlement-rejection 402 path. The public 0xkey client therefore wraps its
  internal `PayError` at that exact seam and preserves the original error only
  as a non-enumerable cause.
- The frozen charge-command addendum's non-2xx enum does not contain
  `PAYMENT_NOT_FOUND` or `PAYMENT_NOT_FULFILLABLE`; those codes belong to the
  separate fulfillment PUT in the Task 4 services brief. Adding them to the
  charge adapter would accept a response forbidden by its endpoint contract.

The official mppx fetch client does not persist or automatically replay an
Authorization credential after HTTP 503. The README and recovery/migration
docs now say that callers must persist and resend the same credential, or use
`createPayClient()` for 0xkey-managed durable recovery.

### RED and GREEN evidence

- Public x402 official-middleware seam:
  - RED: `pnpm --filter @0xkey-io/pay exec jest --runInBand src/x402/index.test.ts`
    returned official middleware HTTP 402 for an indeterminate public-client
    settle instead of the required non-402 boundary response.
  - GREEN: the same command passed 12/12 after the exact
    `FacilitatorResponseError` boundary was installed; the official
    `@x402/express` middleware test returns 502 and never calls the handler.
- Structured private command errors:
  - RED: `pnpm --filter @0xkey-io/pay exec jest --runInBand src/internal/zeroxkey-settlement-adapter.test.ts`
    reported five failures because structured 400/409/502/503 responses and a
    deterministic nested `success:false` response collapsed to UNKNOWN.
  - GREEN: the same command passed 13/13. Exact error keys, status/code and
    retryability pairs, optional UUID payment id, strict nested success shape,
    normalized validated EVM payer comparison, and malformed-boundary UNKNOWN
    are covered.
- Raw public MPP integration:
  - RED: `pnpm --filter @0xkey-io/pay exec tsx --test src/mpp/index.node.test.ts`
    produced actual HTTP 402 for a real signed credential whose settlement
    transport failed after send, and allowed an unknown raw payload key to
    reach settlement.
  - GREEN: the same command passed 5/5. Actual `Mppx.create({methods:[method]})`
    returns HTTP 503 with `Retry-After: 2`, no retry challenge, no receipt, no
    handler and no secret log; exact raw payload keys are checked before Zod's
    lossy parse. A standard non-boundary mppx response is preserved unchanged.
- Seller deterministic vs indeterminate classification and capability cache:
  - RED: `pnpm --filter @0xkey-io/pay exec tsx --test src/server.node.test.ts`
    showed structured deterministic conflicts as UNKNOWN, `success:false` as a
    custom 400, failed admission trapped in cache, and no explicit concurrent
    initialization single-flight proof.
  - GREEN: `pnpm --filter @0xkey-io/pay exec tsx --test src/server.node.test.ts src/mpp/index.node.test.ts`
    passed 13/13. x402 and MPP `success:false` stay native 402 with handler zero;
    400/401/403/409/502/503 boundary errors stay stable; successful discovery
    has a 30-second freshness bound; rejected initialization clears server and
    capability data; concurrent first requests share one initialization and
    one `/supported` call.
- Express response bridge:
  - RED: `pnpm --filter @0xkey-io/pay exec jest --runInBand src/frameworks.test.ts`
    timed out on close/error and did not cancel the upstream reader.
  - GREEN: the same command passed 8/8 after drain/close/error were raced with
    listener cleanup and reader cancellation; binary `0xff 0x00`, multi-chunk,
    streaming/backpressure and cached facade construction are covered.
- Runtime and packed class identity:
  - RED: `pnpm --filter @0xkey-io/pay artifact:test` initially failed the fresh
    runtime smoke because the new public x402 factory was not imported.
  - GREEN: the same command passed 6/6. The installed project runs ESM and CJS
    real signed MPP UNKNOWN tests and actual public-x402-plus-official-Express
    UNKNOWN tests. `npm ls --parseable` finds exactly one mppx and one
    `@x402/core` physical path, with no handler or secret leakage.
- Capability and deterministic-rejection follow-up RED:
  - RED: the combined focused Node command passed 9/13: admission recovery
    remained 502 and both x402/MPP `success:false` responses were custom 400.
  - GREEN: the same combined command passed 13/13 after rejected cache clearing
    and restricting the request-local override to non-402 boundary failures.

### Final verification after the last runtime edit

- `pnpm --filter @0xkey-io/pay test:pay-v1` — PASS: 7 Jest suites,
  103 tests; Node tests 13/13.
- `pnpm --filter @0xkey-io/pay typecheck:pay-v1` — PASS.
- `pnpm --filter @0xkey-io/pay build` — PASS, ESM and CJS entries emitted.
- `pnpm --filter @0xkey-io/pay docs:check` — PASS; generated facts and manual
  documentation agree.
- `pnpm --filter @0xkey-io/pay pins:check` — PASS.
- `pnpm --filter @0xkey-io/pay test:interop` — PASS: official x402 and native
  MPP across both Base networks; mppx 0.8.19 validator passed.
- `pnpm --filter @0xkey-io/pay artifact:test` — PASS: 6/6.
- `pnpm --filter @0xkey-io/pay artifact:check` — PASS: packed, verified,
  fresh-installed, one exact class owner each, ESM/CJS runtime smoke, official
  x402 Express injection, and public types.
- `pnpm --filter pay-v1-uat typecheck` — PASS.
- `pnpm --filter pay-v1-uat smoke` — PASS (`pay_v1_uat_smoke_passed`).
- `pnpm --filter @0xkey-io/contract-guard audit:exports` — PASS (existing
  unrelated unbuilt-package skips only).
- `pnpm --filter @0xkey-io/contract-guard audit:declarations` — PASS (same
  unrelated skips).
- `pnpm --filter @0xkey-io/contract-guard audit:surfaces` — PASS, 23 packages.
- `git diff --check` — PASS.

### Re-review self-review and remaining concern

- No standard receipt/object or root declaration exposes `paymentId` or a
  protocol wire type. Seller x402/MPP state remains request-local.
- UNKNOWN never becomes a fresh 402: official public x402 middleware returns a
  non-402 boundary response, and raw official mppx HTTP returns 503 without
  `WWW-Authenticate`. Deterministic credential rejection remains the protocol's
  native 402.
- Private stamped settlement and fulfillment requests still set
  `redirect: "error"`; the redirect tests prove no second-host credential leak.
- CI/publish select Node 22.12 without changing the whole repository baseline.
- Remaining external boundary: services do not implement the frozen private
  charge and fulfillment contracts until Task 4. No deployment or end-to-end
  service conformance is claimed here.

## Round-2 re-review closure (2026-08-27)

Round 2 found one remaining economic fail-open in the public official x402
settle decoder, a process-global mppx schema mutation, an incomplete raw MPP
wire guard, and three release/runtime consistency gaps. All findings are closed
without changing a public factory name or expanding into Task 4.

### RED/GREEN evidence

- Shared strict private settlement decoder:
  - RED: `pnpm --filter @0xkey-io/pay exec jest --runInBand src/x402/index.test.ts src/internal/zeroxkey-settlement-adapter.test.ts`
    failed 15/42. Official `/settle` accepted outer/nested extensions, wrong
    network, wrong/missing payer and zero transaction; the command decoder
    accepted incorrectly typed optional fields; every structured official
    error collapsed to UNKNOWN.
  - GREEN: the same focused suites passed 44/44, then 45/45 after adding the
    explicit standard `success:false` regression. Both transports now call
    `private-settlement-response.ts`, which enforces exact outer/nested keys,
    UUID, configured network, requested amount when returned, matching valid
    payer, a non-zero transaction on success, an empty transaction on
    deterministic failure, and exact optional field types. The official path
    preserves strict structured 400/401/403/409/502/503 errors as the original
    `PayError` cause and never reaches official middleware continuation after
    an unbound success.
- Request-local full raw MPP guard:
  - RED: `pnpm --filter @0xkey-io/pay exec tsx --test src/mpp/index.node.test.ts`
    passed 6/9 and failed the singleton-schema identity plus unknown outer and
    challenge key cases; the invalid credentials settled successfully.
  - GREEN: the focused suite passed 11/11 after moving the guard to the
    per-method `Transport.http().getCredential` boundary. The final suite is
    12/12 with a repeated `createPayServer()` isolation regression. Raw outer,
    challenge, payload, serialized request, and methodDetails keys are checked
    before mppx parsing; standard `description`, `digest`, `expires`, `header`,
    `meta`, `opaque`, realm/id/method/intent/request fields remain accepted.
    Two direct factories and repeated seller challenge creation leave an
    unrelated upstream charge schema's `parse` reference unchanged.
- Express full-lifetime cancellation:
  - RED: `pnpm --filter @0xkey-io/pay exec jest --runInBand src/frameworks.test.ts`
    passed 8/11; close before the first chunk, close between chunks, and error
    during a pending first read all remained blocked.
  - GREEN: the same suite passed 11/11. One lifecycle listener pair now races
    every `reader.read()` and drain wait, cancels the upstream reader on close
    or error, preserves the original downstream error, and removes only its own
    close/error/drain listeners in `finally`.
- Peer manifest and all Pay-affecting workflow runtimes:
  - RED: `pnpm --filter @0xkey-io/pay artifact:test` passed 5/7. The static
    guard found Commerce Contract on Node 20 and the parsed manifest lacked its
    Viem peer (Commerce Verifier had the same Node defect).
  - GREEN: the same command passed 7/7. One `peerDependencies` object now has
    exact class owners `@x402/core@2.23.0`, `mppx@0.8.19`, and the retained
    `viem>=2.54.0 <3` runtime contract. The packed checker asserts all three,
    installs with npm `--strict-peer-deps`, lists Viem, and imports it directly.
    Its workflow list covers Pay GA, Pay publish, Commerce Contract, and
    Commerce Verifier; all select Node 22.12.0.
- Type gate stabilization:
  - RED: `pnpm --filter @0xkey-io/pay typecheck:pay-v1` identified two computed
    optional-field narrowing errors and the new deep module missing from the
    explicit build file list.
  - GREEN: the same command passed after local-value narrowing and adding the
    module to `tsconfig.pay-v1.build.json`.

### Design and contract decisions

1. `private-settlement-response.ts` is an upstream-independent deep module.
   It returns a private structural settlement type rather than importing an
   x402 wire type, so the 0xkey command adapter stays protocol-independent.
   The official x402 transport converts that structural result only at its own
   dedicated seam.
2. Successful private settlements require `payer`, despite the JSON Schema
   listing it as an optional property, because the frozen normative prose says
   success binds the verified signer. Deterministic `success:false` may omit it
   and remains each protocol's native 402.
3. The raw MPP request is decoded with the official `PaymentRequest` codec only
   to inspect exact raw keys, then the official `Credential.deserialize` and
   normal mppx method schemas remain authoritative for types and signatures.
   No upstream singleton or consumer `node_modules` is patched.
4. The Viem peer remains the pre-existing compatible range, while the two
   error-class owners remain exact pins. Fresh strict npm installation resolved
   one physical mppx and one physical x402 core owner and a direct Viem import.

### Round-2 final verification

- `pnpm --filter @0xkey-io/pay test:pay-v1` — PASS: 7 Jest suites / 126 tests;
  Node tests 20/20.
- `pnpm --filter @0xkey-io/pay typecheck:pay-v1` — PASS.
- `pnpm --filter @0xkey-io/pay build` — PASS, ESM and CJS.
- `pnpm --filter @0xkey-io/pay pins:check` — PASS.
- `pnpm --filter @0xkey-io/pay docs:check` — PASS.
- `pnpm --filter @0xkey-io/pay test:interop` — PASS, official x402/native MPP
  across both Base networks and mppx 0.8.19 validation.
- `pnpm --filter @0xkey-io/pay artifact:test` — PASS, 7/7.
- `pnpm --filter @0xkey-io/pay artifact:check` — PASS: packed, verified,
  strict-peer fresh install, ESM/CJS runtime, one class owner each, direct Viem,
  official x402 middleware and raw MPP UNKNOWN behavior.
- `pnpm --filter pay-v1-uat typecheck` — PASS.
- `pnpm --filter pay-v1-uat smoke` — PASS (`pay_v1_uat_smoke_passed`).
- Contract guard exports/declarations/surfaces — PASS (23 package surfaces;
  only the pre-existing unrelated unbuilt-package skips).
- `git diff --check` — PASS.

No new concern was introduced. Task 4 still owns service implementation and
deployment of the already frozen private contracts; this SDK task makes no
claim that those later service gates have run.
