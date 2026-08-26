# Task 3 report — Pay 1.0 server and protocol adapters

Status: **DONE_WITH_CONCERNS**

Implementation commit: `b95ada0a2` (`feat(pay): add GA server protocol adapters`)

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
  - PASS: 6 Jest suites / 73 tests; Node tests 6/6.
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
  contracts in this task. Services implement them in later tasks, so this report
  does **not** claim cross-repository or deployed end-to-end conformance.
- The x402 npm/source upfront discrepancy is contained and tested, but should be
  removed when a published upstream release exposes the pinned source behavior
  directly.
- The packed TypeScript smoke uses `skipLibCheck` only because mppx's server
  declaration references its optional MCP peer even when the EVM-only path is
  used. The 0xkey declarations themselves are compiled and separately audited.
