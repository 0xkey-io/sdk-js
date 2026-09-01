# Pay conformance — checkpoint 7A

Private SDK-owned verification inputs and safety primitives. **This checkpoint
does not run protocol conformance and cannot produce a passing matrix.** The
services-owned cross-repository release runner is separate. No package exports,
public runtime, provider support or dependency policy change here.

## Run the foundation

Use the repository-pinned pnpm 10.6.3 and Node 24.3.0 with an already provisioned
offline store. Provisioning is a separate authorized operation. Set explicit
owned empty npm user/global configs and disable Corepack network access; never
read ambient credentials or enable an online fallback. Then, from the SDK root:

```sh
pnpm --filter @0xkey-io/pay-conformance test
pnpm --filter @0xkey-io/pay test:conformance --output /absolute/new-report.json
```

The second command requires an existing parent directory outside the checkout
and a nonexistent output file. It verifies all committed input/license hashes,
writes a complete immutable report and exits **1** (`BLOCKED`, `not_approved`).
It neither installs fixtures nor invokes any driver, validator or paid CLI.
Rejected arguments, modified inputs and existing output paths return a redacted
`FAILED` summary and exit 1; `--help` exits 0. Do not interpret either exit code
alone as release approval. The legacy environment-selected validator smoke is
not invoked or credited by this path; its replacement belongs to checkpoint 7C.

## Exact input boundary

[`fixtures/inventory.json`](./fixtures/inventory.json) binds 11 fixture groups,
24 manifest/lock files and five upstream license/notice files by SHA-256. Inputs
have repository-relative paths, not retained machine paths or reference-clone
imports. `originalInputs` records the retained readiness-source hashes; only
the explicitly described package metadata was changed. Lock bytes and
dependency selections were preserved. Licenses cover the four primary frozen
upstreams; locks retain dependency integrity metadata, not a transitive-license
audit or release SBOM.

| Fixture                  | Exact selection and ownership                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Native Node              | x402 2.23.0 / 2.22.0; mppx 0.8.19 / 0.8.17, separate locks/processes                                  |
| Official x402 frameworks | Express, Hono and Next fixtures separately locked for both x402 versions                              |
| Validator only           | mppx 0.8.19 + incur 0.5.1; public validator with `skipPayment: true`, actual 16 checks required in 7C |
| Go                       | Frozen `v2.23.1-0.20260826184309-acaa90458564`, not the public v2.23.0 tag                            |
| Python                   | Frozen source-verified x402 2.20.0 wheel; not the different same-version registry wheel               |
| Ruby                     | mpp-rb 0.1.5 at exact Git revision; EVM seller only                                                   |
| mpp-tools                | Exact upstream npm/uv locks (mppx 0.8.18); generic wire vectors only                                  |

The execution toolchain is Node 24.3.0, Go 1.24.5, Python 3.13.7, Ruby 4.0.1,
Bundler 4.0.3 and uv 0.11.0. A frozen source snapshot establishes capability
provenance; it does not assert byte identity with npm registry artifacts.

7A verifies committed inputs without resolving/installing them. The Python
wheel at `fixtures/python-x402/artifacts/x402-2.20.0-py3-none-any.whl` is an
explicit 7C staging prerequisite with its already provisioned artifact hash.
Go/Ruby caches, Python dependencies, Node stores and the generic corpus are
already provisioned execution inputs, not missing public dependencies. Their
portable staging/import/driver work is owned by 7B/7C. No runtime file may
depend on the original readiness directory. Install each Node fixture into its
own unrelated directory, offline/frozen/ignore-scripts, before using it. Never
install version fixtures into this workspace or replace public APIs with aliases.

## Private recovery profiles

The ordinary recovery wrapper is `test/integration/native-recovery.mjs`;
`test/integration/native-billing-recovery.mjs` selects the billing profile
explicitly. Billing is restricted to existing MPP recovery rows and
`development-only` inputs. Both the shared integration contract and direct
driver reject `final-7b` billing after input-directory validation but before
consumer payload reads, fixture imports, row evidence creation or role startup.
Ordinary recovery keeps its existing development/final stage behavior.

Recovery `observation.json` and scenario `failure.json` bind the selected
`row`, `stage` and closed `profile` (`ordinary` or `billing`). The integration
contract checks these fields against its explicit selection, never against the
input filename or test title. Profile is private evidence metadata: it changes
neither the public control-event schema nor matrix rows, scope or pass status.
Billing development evidence does not satisfy an ordinary final recovery row.

Foundation tests include the real early-rejection entrypoints and ordinary
stage controls. With an explicitly supplied, already verified MPP execution
input, the following also tests real driver failure evidence using fresh empty
certificate directories; it does not install or modify the retained consumer:

```sh
node internal/pay-conformance/test/recovery-entrypoint.test.mjs /absolute/input.json
```

Recovery, freeze and preflight capture reference their existing IPC channel
after durable save and before reporting capture. The store callback stays
pending without returning to signed send; only the supervisor ends that buyer
with SIGKILL. An unresolved await alone does not keep the child alive.

The separately provisioned lifecycle regression uses the actual private buyer,
retained public Pay package, native fixture, owned TLS and authenticated disk
store. It closes the owned HTTPS listeners after capture, observes the buyer
for one second with a supervisor-only timer, then requires silent survival until
SIGKILL. It retains role stream byte counts/hashes, termination, source/input/consumer owners
and cleanup evidence. It is outside the default foundation suite, accepts only
development inputs and does not establish settlement or matrix acceptance:

```sh
node internal/pay-conformance/test/integration/native-capture-lifetime.mjs /absolute/input.json
```

## Private signed-wire development slice

`test/integration/native-wire.mjs` runs six closed S/wire controls against an
explicitly verified retained artifact: synthetic opposite credential header,
canonical `payload:null`, accepted/echoed-challenge chain and asset mismatch,
and payload recipient and amount mismatch. Use one existing fault family per
invocation, then inspect its result before starting the next:

```sh
node internal/pay-conformance/test/integration/native-wire.mjs \
  /absolute/development-input.json malformed-ambiguous-offer
```

The other filters are `network-mismatch`, `asset-mismatch`, `payee-mismatch`
and `amount-mismatch`. Both import/require conditions run with at most two
isolated subcases at once and the unchanged60-second row deadline. These
development-only results keep `coverage: partial` and `aggregateStatus: BLOCKED`;
they cannot satisfy a final matrix row or final-tar acceptance.

The selected native buyer signs once; its transport mutates the wire **before
the first signed send**. Original native and transmitted credential/header
digests are separate. An added synthetic opposite header is an ambiguity
control, not two independently valid credentials. After the negative checkpoint
proves effect0, a separate native buyer process sends an unchanged credential
and calibrates successful verification/settlement/handler/effect/fulfillment.
It is not durable recovery or an application replay of the negative wire.

Merchant and private facilitator arrivals are observed before parsing, with
separate body-read, stamp-metadata-check, authorization-check and response
timestamps. `stampMetadataValidatedAtNs` describes fixture metadata assertions,
not cryptographic X-Stamp validation. Existing verify/settle counters describe
validated operations, never all arrivals. For S/x402, `server.ts`'s
protect-scoped `getX402Supported` cache is shared by newly initialized resource
servers: an initial HTTP supported arrival1 may be followed by signed requests
with no further discovery arrival. Initialization is not proof of network I/O.
The positive S/x402 path really calls verify1; MPP has no separate verify call.

Rejection ownership remains explicit: x402 accepted chain/asset changes fail
native core matching402, while payload shape/economics fail Pay adapter400.
MPP echoed challenge economics fail native HTTP HMAC402; payload shape fails
the raw-wire guard/native malformed response, and payload economics fail the
native EVM verifier402. These are S seller peer owners, not N−1 seller peers.
Actual buyer and seller public import/require owners remain in role evidence.
This development slice still does not cover the separate final aggregates.
The final temporal dispatcher uses actual `validAfter`/`validBefore` fields,
re-signs the changed typed data with the same native account, and pairs every
negative with a fresh official positive. Invalid base64/JSON decoding,
unsupported authorization, full malformed corpus and direct adapter ownership
have their own dispatchers or remaining gates.
No decoder-warning exception is authorized by these controls.

## Private signed credential decoder diagnostic

`test/integration/native-wire-decoder.mjs` selects one closed development case
(`credential-invalid-encoding` or `credential-invalid-json`) and one entry
condition (`import` or `require`) per invocation. It replaces the selected
credential before the first native signed send: `%` is invalid encoding;
`ew==` (x402) or `Payment ew` (MPP) encodes incomplete JSON `{`. Neither is the
accepted payload-null control or unchanged native output. Native/transmitted
and unchanged request binding/header/body digests remain separate.

The decoder slice has its own exclusive IPC profile and uses the unchanged
60-second row deadline. Its negative phase snapshots actual arrivals/effects,
writes an exclusive checkpoint file before assertions or shutdown, then closes
all roles and waits for complete streams. The separate final outcome references
the checkpoint hash and records write/close/cleanup ordering. A later cleanup
exception cannot prevent that earlier checkpoint write; this is not a
transactional or power-loss guarantee. Any forbidden output
fails before creating a positive phase. A clean negative may be followed by
an entirely fresh merchant/facilitator/native-buyer phase; x402 positive then
has its own supported1, not a shared-listener cache delta. This is independent
calibration, not durable recovery or identical-request replay. Endpoint hashes
and role inventories identify each phase.

The x402 S path is core2.23 header decoding followed by ordinary unpaid402;
its installed decoder's `console.warn` is **not allowed** by the supported
warning exception. MPP first fails Pay's raw-wire atob/JSON guard, then native
mppx0.8.19 HTTP classifies malformed-credential402: this does not prove direct
native Credential.deserialize coverage. N−1 versions remain separate buyers.
A strict-output failure freezes further variants for controller diagnosis;
nonempty output alone does not establish credential leakage or its severity.
All evidence stays development-only/partial/BLOCKED.

## Private supported-failure final rows

`test/integration/native-supported-final.mjs` selects only the `final-7b`
`supported-failure` row for x402 2.23, x402 2.22, mppx 0.8.19 or mppx
0.8.17. The independent `supportedFailureFinal` discriminator and
`supported-final-controls` slice reject other rows, stages and protocols. Each
profile binds the exact installed `@x402/core@2.23.0`,
`@x402/core@2.22.0`, `mppx@0.8.19` or `mppx@0.8.17` owner before I/O.

The x402 rows run the three dual-seller dependency failures and the three
direct public `getSupported()` failures under import and require, for twelve
exact tuples. The MPP rows run the same three unsigned dual-seller dependency
failures plus the MPP-only nondependency positive under import and require,
for eight exact tuples. Timeout, invalid JSON and invalid shape each have a
fresh successful discovery calibration. The MPP seller path proves that x402
initialization is a dependency of the default dual seller; it does not claim
MPP owns support discovery. The MPP-only positive proves the inverse boundary.
Complete observations retain bounded timings, counters, inventories and
digests without raw responses or credentials. This executable does not by
itself admit a row, alter `matrix.json`, or change public Pay behavior.

## Private handler-failure final rows

`test/integration/native-handler-failure-final.mjs` selects only the
`final-7b` `handler-failure` row for x402 2.23, x402 2.22, mppx 0.8.19 or
mppx 0.8.17. Its independent `handlerFailureFinal` discriminator and
`handler-failure-controls` slice reject every other family, stage and profile.
The row identifies its installed x402 or MPP dependency version before I/O.

The closed catalog is `handler-throws`, `handler-500`, `handler-400`,
`handler-404`, `handler-302`, `handler-200`, and
`fulfillment-failed-after-handler-failure`, under import and require for
fourteen tuples per row. A native buyer performs the first signed request; all
cases except `handler-200` repeat the captured identical credential in the
same application-owned process. Evidence binds settlement/economic identity,
handler and application-effect counts, fulfillment state, receipt/status,
redirect-zero, TLS, strict output and cleanup. The retry is not native durable
recovery and never claims a new signature repairs fulfillment. This executable
does not by itself admit a row, alter `matrix.json`, or change public Pay
behavior.

## Private fulfillment-failure final rows

`test/integration/native-fulfillment-failure-final.mjs` selects only the
`final-7b` `fulfillment-failure` row for x402 2.23, x402 2.22, mppx 0.8.19 or
mppx 0.8.17. Its independent `fulfillmentFailureFinal` discriminator and
`fulfillment-failure-controls` slice reject every other family, stage and
profile. The row identifies its installed x402 or MPP dependency before I/O.

The closed catalog is `fulfillment-http-503`, `fulfillment-disconnect`,
`fulfillment-timeout`, and `fulfillment-unexpected-2xx`, under import and
require for eight tuples per row. A native buyer performs the first signed
request, then the application retries its captured identical credential in the
same process. Evidence binds strict HTTP 200 acknowledgement, actual transport
failure, stable settlement/economic and private payment identities, a single
application effect, receipt/status, TLS, output and cleanup. This is not
durable recovery or re-sign evidence. The executable does not by itself admit
a row, alter `matrix.json`, or change public Pay behavior.

## Private standard-wire-receipt final rows

`test/integration/native-standard-wire-receipt-final.mjs` selects only the
four current/N−1 `final-7b` `standard-wire-receipt` rows. Its closed catalog
runs each native decoder/private-field exclusion case as a separate signed
buyer-to-seller invocation under import and require. MPP additionally invokes
the selected physical owner's synchronous `respondReceipt` boundary for 2xx
emission and non-2xx suppression while preserving the caller response.

Evidence retains only public receipt field names and hashes; no raw receipt,
private envelope or payment ID is serialized. Receipt decoding does not prove
economic effect or application fulfillment. This executable does not by itself
admit a row, alter `matrix.json`, or change public Pay behavior.

## Private malformed-ambiguous-offer final rows

`test/integration/native-malformed-ambiguous-offer-final.mjs` selects only the
four current/N−1 `final-7b` `malformed-ambiguous-offer` rows. It composes the
closed offer, preflight, dual-offer, wire and official decoder controls under
import and require. The x402 catalog has 24 tuples; the MPP catalog has 22
because `unsupported-scheme` is x402-only. Decoder tuples contain separate
fresh negative and positive native phases.

The MPP selected-malformed credential corpus remains owned by its four
separate corpus rows and is deliberately excluded here. This executable does
not admit a row, alter `matrix.json`, authorize publication, or change public
Pay behavior.

## Private MPP malformed-wire corpus final rows

`test/integration/native-mpp-malformed-corpus-final.mjs` selects exactly the
four `native-corpus` rows for MPP 0.8.19/0.8.17 under import/require. Each row
runs the fixed 104-case 0xkey-owned local regression corpus against the packed
Pay consumer and selected physical native MPP owner. Raw bodies, headers,
credentials and sentinels remain process-private; final evidence retains only
allowlisted labels, public problem types, header names, counters and hashes.

This is not an upstream conformance suite, official-buyer proof, durable
restart proof, or permission to broaden the MPP admission surface. The corpus
executable does not alter `matrix.json`, public Pay behavior or production
state.

## Private x402 unsupported-authorization final rows

`test/integration/native-unsupported-authorization.mjs` selects only the
`final-7b` `x402-2.23-unsupported-authorization` and
`x402-2.22-unsupported-authorization` rows. Both versions reuse one frozen
catalog: offer and credential paths each run `permit2`, `upto` and
`unknown-required-extension` under import and require. The physical fixture
graph identifies `@x402/evm@2.23.0` or `@x402/evm@2.22.0` before I/O; a row,
owner or stage mismatch is rejected.

For both owners, `permit2` and the fixed `future-transfer` unknown value select
`accepts[].extra.assetTransferMethod`; `upto` selects `accepts[].scheme`. The
unknown case name does not mean optional `PaymentRequired.extensions` or JSON
Schema metadata. Every negative has a fresh native positive calibration, and
the credential path uses the official x402 header encoder without claiming a
valid signature. This closes only the selected row; the two MPP rows remain
unadmitted and the matrix inventory is unchanged.

## Private MPP unsupported-authorization final rows

`test/integration/native-mpp-unsupported-authorization.mjs` selects only the
`final-7b` `mppx-0.8.19-unsupported-authorization` and
`mppx-0.8.17-unsupported-authorization` rows. Their shared closed catalog is
`session-intent` and `non-evm-method` at the offer boundary plus
`unsupported-authorization-payload` at the credential-wire boundary, under
both import and require. The physical fixture and packed consumer must identify
the row's exact `mppx@0.8.19` or `mppx@0.8.17` owner before I/O.

The offer negatives mutate actual MPP challenge `intent` or `method` fields and
must stop before signing. The wire negative starts with the official EVM client,
then changes only the decoded real Authorization payload discriminator to the
fixed unsupported value before the native server decoder classifies it as an
invalid payload. Each negative has a fresh native positive calibration. Safe
evidence keeps actual selected method/intent and bounded counters, never raw
credentials, signatures, private keys or receipts. This closes only those two
exact MPP rows; the matrix inventory and public Pay runtime are unchanged.

## Private x402 network-mismatch final rows

`test/integration/native-network-mismatch.mjs` selects only the `final-7b`
`x402-2.23-network-mismatch` and `x402-2.22-network-mismatch` rows. Their
shared closed catalog runs the actual
`other-base-network-offer` and `unsupported-chain-offer` Payment-Required
boundaries, `credential-offer-chain-mismatch` signed-wire boundary and
`pending-open-other-network` durable-restart boundary under import and require.
Each fixture identifies its exact `@x402/evm@2.23.0` or
`@x402/evm@2.22.0` owner before I/O; the offer and wire paths use that graph's
installed x402 public encoders and decoders.

Every negative has a fresh native positive calibration. Offer rejection stops
before signing or I/O; the signed-wire mutation changes only
`accepted.network` after a genuine native credential is produced; restart
keeps the authenticated Sepolia pending bytes unchanged while an incompatible
Base-mainnet client is rejected before any new operation or transport. The
original profile then resumes the same credential through local receipt proof
and safe clear. One complete observation checks exact catalog equality; the
development-only partial offer, wire and preflight files are not final-row
evidence. This private executable does not admit either row, change the matrix
or change the public Pay runtime.

## Private mppx network-mismatch final rows

The dedicated private MPP final discriminator and runner select
`mppx-0.8.19-network-mismatch` and `mppx-0.8.17-network-mismatch` only under
`final-7b`; the x402
`networkMismatchFinal` discriminator remains x402-only. Its closed catalog is
the two native Challenge offer rejections,
one signed Credential wire rejection and one authenticated pending-profile
restart, under import and require. Each row's offer controls use its installed
`mppx@0.8.19` or `mppx@0.8.17` `Challenge.fromResponse` and
`Challenge.serialize` boundary without widening the other profile.
The wire control starts with a genuine official Credential and changes only
its independent `source` network from `eip155:84532` to `eip155:8453` through
`Credential.deserialize` and `Credential.serialize`; the original Challenge
and payload remain digest-identical and the native server classifies the
result as verification failed. Mutating the Challenge chain is an invalid-
challenge control and is not evidence for this row.

Offer rejection remains before signing or I/O. The incompatible restart
preserves the authenticated Sepolia pending bytes, performs no new operation
or transport, and the original profile resumes the same credential through
local proof and safe clear. These exact executables do not admit either row,
change `matrix.json`, or change the public Pay runtime.

## Private x402 N/N-1 amount-mismatch final rows

`test/integration/native-amount-mismatch.mjs` selects only
`x402-2.23-amount-mismatch` or `x402-2.22-amount-mismatch` under `final-7b`.
Its independent
`amountMismatchFinal` discriminator, `amount-mismatch-controls` slice and
runner reject every other x402 version, MPP, other families and development
inputs. The
closed catalog is `above-ceiling`, `negative`, `non-integer-atomic` and
`malformed-price` at `accepts.amount`, plus
`credential-offer-amount-mismatch` at `payload.authorization.value`, under
import and require for ten exact tuples.

Offer and signed-wire mutations use the selected row's installed public header
decoder and encoder. Offer negatives stop before signature, persistence,
private I/O, effect, RPC or redirect. The signed-wire negative signs and sends
once, preserves every non-amount field, and is rejected before verification,
settlement, fulfillment, handler or effect. Every negative has a fresh native
positive calibration. Each complete observation does not admit its row, alter
`matrix.json`, or change public Pay behavior.

## Private x402 2.23 and 2.22 payee-mismatch final rows

`test/integration/native-payee-mismatch.mjs` selects only
`x402-2.23-payee-mismatch` or `x402-2.22-payee-mismatch` under `final-7b`. Its independent
`payeeMismatchFinal` discriminator, `payee-mismatch-controls` slice and runner
bind the selected row's installed `@x402/evm@2.23.0` and
`@x402/core@2.23.0`, or `@x402/evm@2.22.0` and `@x402/core@2.22.0`, owners.

The closed catalog contains `invalid-recipient-offer` at `accepts.payTo` and
`credential-offer-recipient-mismatch` at `payload.authorization.to`, under
import and require for four exact tuples. The offer negative tests only invalid
address syntax: the public buyer has no independent payee allowlist, so an
arbitrary different valid offer recipient is not treated as forbidden. The
signed-wire negative changes the credential recipient away from the frozen
offer recipient and stops before verification, settlement, fulfillment,
handler or effect. Every negative has a fresh native positive calibration.
This private executable does not admit either row or change public Pay behavior.

## Private MPP current/N−1 payee-mismatch final rows

`test/integration/native-mpp-payee-mismatch.mjs` selects only
`mppx-0.8.19-payee-mismatch` or `mppx-0.8.17-payee-mismatch` under `final-7b`.
Its independent
`mppPayeeMismatchFinal` discriminator, `mpp-payee-mismatch-controls` slice and
`runCurrentMppPayeeMismatch` runner bind an explicit profile for each version
and reject every other MPP version, x402, other fault families and development
inputs.

The closed catalog contains `invalid-recipient-offer` at
`request.recipient` and `credential-offer-recipient-mismatch` at `payload.to`,
under import and require for four exact tuples. Each row's installed
`mppx@0.8.19` or `mppx@0.8.17` `Challenge` and `Credential` codecs decode and
re-encode the transmitted values. Digest evidence binds every non-recipient
payload member and the complete Challenge. Offer rejection is pre-sign; the signed-wire
negative signs and sends once, returns `verification-failed`, and stops before
verification, settlement, fulfillment, handler or effect. Every negative has
a fresh native positive calibration. This executable does not by itself admit
either row, alter `matrix.json`, or change public Pay behavior.

## Private MPP current/N−1 amount-mismatch final rows

`test/integration/native-mpp-amount-mismatch.mjs` selects only
`mppx-0.8.19-amount-mismatch` or `mppx-0.8.17-amount-mismatch` under
`final-7b`. Its independent `mppAmountMismatchFinal` discriminator,
`mpp-amount-mismatch-controls` slice and `runCurrentMppAmountMismatch` runner
bind an explicit profile for each version and reject every other MPP version,
x402, other fault families and development inputs.

The closed catalog contains `above-ceiling`, `negative`,
`non-integer-atomic`, and `malformed-price` at `request.amount`, plus
`credential-offer-amount-mismatch` at `payload.value`, under import and require
for ten exact tuples. Each row's installed `mppx@0.8.19` or `mppx@0.8.17`
`Challenge` and `Credential` codecs decode and re-encode the transmitted
values. Digest evidence binds the complete Challenge and every non-amount
payload member. Offer rejection is pre-sign; the signed-wire negative signs
and sends once, returns `verification-failed`, and stops before verification,
settlement, fulfillment, handler or effect. Every negative has a fresh native
positive calibration. This executable does not by itself admit either row,
alter `matrix.json`, or change public Pay behavior.

## Complete planned matrix

[`matrix.json`](./matrix.json) is the reviewed row inventory, not an execution
result. Version maps come from each exact fixture; each row names its future
driver and owner. Aggregate fault rows must execute every applicable variant
and retain individual observations before becoming passes in a later gate.

| Family                                                             |    Rows | 7A result                         |
| ------------------------------------------------------------------ | ------: | --------------------------------- |
| Native directions, four versions × two directions × import/require |      16 | BLOCKED                           |
| Mandatory fault families, 19 × four versions                       |      76 | BLOCKED                           |
| Durable AEAD disk/key-backed recovery, four versions               |       4 | BLOCKED                           |
| Official low-level/resource/HTTP and framework upfront injection   |      20 | BLOCKED                           |
| Exception ownership, configured upfront and typed recipe controls  |      12 | BLOCKED                           |
| Native MPP malformed wire corpus                                   |       4 | BLOCKED                           |
| Public validator-only API                                          |       1 | BLOCKED                           |
| Go/Python buyers and Ruby EVM seller                               |       3 | BLOCKED                           |
| Separately named generic mpp-tools wire vectors                    |       5 | BLOCKED                           |
| Frozen capability boundaries                                       |       3 | NOT_APPLICABLE                    |
| Full paid validator CLI                                            |       1 | BLOCKED (external)                |
| **Total**                                                          | **145** | **142 BLOCKED, 3 NOT_APPLICABLE** |

The three N/A facts are precisely Ruby EVM buyer, CDP high-level server
facilitator injection, and official mpp-tools native EVM charge. Evidence is
[`fixtures/capabilities.json`](./fixtures/capabilities.json), hashed in each
row and source-pinned. They do not waive low-level x402, Ruby seller or generic
wire testing. The full paid CLI needs separate authorization; no keychain,
Stripe, RPC, funding or real payment is allowed here.

7B must supply public **packed** SDK/native fixtures over owned-CA loopback
HTTPS, wrong-CA controls, no DNS/off-loopback/redirect fallback, calibrated
observed counters, and actual multiprocess durable recovery. Same credential,
save-before-send, no re-sign/protocol switch on UNKNOWN/timeout/5xx, and
receipt/economic proof before clear remain mandatory. Handler calls and
application/economic effects are different counters; a direct official caller
owns business idempotency. 7C adds cross-language/validator/generic execution
and reruns the applicable complete matrix against one final checked artifact
and an unrelated offline-installed consumer. Earlier checkpoint tarballs and
readiness outputs must not be relabeled as that evidence. Product defects go
back to their owner with a failing row, not runtime fixes in this harness.

## Safety and evidence contract

The private `replay-controls` final runner is restricted to the four fixed
`*-replay` rows at `final-7b`. For each installed protocol version it executes
ten import/require tuples: durable same-process and fresh-process Pay-buyer
resume, identical captured-request replay by the official direct caller, and
single-client/multi-client claim ownership. Its observations retain hashes and
counts, prove one credential with one economic and application effect, and
state that production services database uniqueness is not proven. This local
runner does not admit a row or authorize publication or deployment.

- `src/process.mjs` launches trusted repository-owned cooperative fixtures in
  detached process groups with a strict allowlist environment, separate empty
  npm configs, offline package-manager flags, byte limits and a deadline.
  A fixture announces its actual versions and waits for the `start` message
  before I/O. The lifecycle is `spawned → identified → ready → observed →
completed → closed`; timeout/corrupt controls cannot pass. Cleanup covers
  ordinary exit, failure and deadline, including listening grandchildren.
  The original `cleanup: { groupAbsent, forced }` shape is unchanged. Additive
  private `diagnostics` retains a bounded (128 event) monotonic timeline, dropped
  event count, close/stdio facts, ownership guard and distinct final cleanup
  state (`present`, `absent`, `unknown`). Only ESRCH establishes absence. Closed
  errno errors are sticky: a later ESRCH can establish final absence, but a
  denied/unknown observation cannot produce an otherwise successful `PASSED`.
  The primary reason (for example `TIMEOUT` or `EXIT_NONZERO`) is retained beside
  `cleanupErrors`; raw syscall messages and process command lines are excluded.
  Group SIGKILL is attempted at most once, guarded by Node's direct-child
  lifecycle state. This guard is not an atomic OS start-identity guarantee.
  After child exit/close, group probes are observations only, never authority to
  signal a numeric PGID. A remaining group is reported, not blindly signalled.
  The row deadline is unchanged. The existing 1000ms cleanup observation budget
  starts at the first stop, or after an ordinary close; a denied SIGKILL that
  leaves close unobserved releases only local stdio handles and unrefs the child
  at that bound. TIMEOUT abandonment returns `UNKNOWN`; an independent primary
  failure retains `FAILED` with cleanup state `unknown`. Both retain
  `groupAbsent: false` and explicit `stdioAbandoned` evidence; this is unresolved
  process cleanup, not success.
  Deterministic syscall-denial tests use real owned children and independent
  test teardown; injection is not a reproduction of an OS permission cause.
  This is not an OS network sandbox or containment after killing the parent.
- `src/redact.mjs` accepts only closed JSONL event schemas: exact version
  metadata, numeric ports/counters and permitted SHA-256 digests. It retains
  only primitive string event kinds from its own closed table; arrays,
  coercible objects and prototype names are rejected before payload dispatch.
  It retains
  no raw unrecognized output or stderr. Process hashes/byte counts cover the
  bounded captured stream, not bytes discarded after an output limit. Raw
  credentials, receipts and secrets must never be control fields or command
  arguments. The test child is only a foundation fixture; its synthetic zero
  counter is **not** protocol calibration or evidence of zero economic effects.
- `src/run.mjs` validates literal loopback HTTPS targets and exact versions;
  it does not yet implement transport interception, certificate issuance,
  actual TLS controls or protocol execution. Those are owned 7B prerequisites.
- `schema/result.schema.json` is a closed five-status row schema. The report
  validator also requires the complete committed matrix: no duplicate/omitted
  IDs, changed contracts, arbitrary observations, invented blockers, unknown
  fields, evidence substitutions or 7A success claims. A generic row helper's
  unit-test `PASSED` is never accepted in a 7A report. `network` names the
  planned safety policy; unexecuted rows do not claim network observations.
- Reports contain source-relative capability evidence paths and actual hashes.
  Publishing checks the evidence bytes, fsyncs a private draft and uses an
  exclusive same-filesystem link; concurrent writers cannot replace a report.
  Runtime reports stay outside Git. Retain source coordinates, command logs,
  diagnostics, all failures and source-at-RED snapshots with the external run
  evidence. The report is an immutable file, not a signed attestation against
  a malicious operator with write access to the source/evidence filesystem.

Foundation tests are intentionally independent of SDK protocol internals.
Passing them establishes these primitives only. No protocol row, public
artifact acceptance, publication, production admission or GA is approved by 7A.

### Shared fixed consumer verification

The private `src/consumer.mjs` adapter retains its original exported API and
strict canonical ASCII bindings. Its fixed graph/Pay verification lives in
release-owned `packages/pay/scripts/fixed-consumer.mjs`, with independently
source-owned raw template SHA256 pins. Inventory/template co-tampering cannot
establish a new graph. The release checker does not import the conformance
runner or matrix. Installed verification rejects unexpected owners, changed
lock-owned dependency metadata and any additional or modified Pay payload.
Only the pinned `@emnapi/runtime` orphan may be absent with its sole
host-incompatible, absent `@img/sharp-wasm32` parent; required cache bytes are
still checked separately. The original four Pay substitution slots and all
fixture/lock bytes remain unchanged.
