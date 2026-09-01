# Native fault coverage contract — 7B implementation input

This is a planned subcase inventory, **not execution evidence**. All 76 fault
rows remain unimplemented until their complete subcases run against the bound
artifact. Development runs use a separately labelled prerequisite artifact;
final 7B reruns use the one newly checked 7B artifact. No earlier repair report
or successful direction/recovery run substitutes for a fault subcase result.

## Row expansion and physical owners

Each family below expands to exactly four existing row IDs:
`x402-2.23-<family>`, `x402-2.22-<family>`,
`mppx-0.8.19-<family>` and `mppx-0.8.17-<family>`.
The 19 family names are exactly `matrix.json.faultFamilies`: 19 × 4 = 76.
This contract does not remove rows, add capability N/A, or authorize 7C.

Each applicable subcase runs under both public `import` and `require`
conditions. The fixture version identifies the actual separate native owner,
not a version label attached to the SDK's installed peer. Before I/O, retain
the actual public bare-specifier resolution, physical entry, manifest version
and entry hash for every participating role.

| Symbol | Actual direction / public boundary | Dependency owner and responsibility |
| --- | --- | --- |
| B | Packed `createPayClient` → selected official seller | Official seller uses selected fixture's resource/Mppx and its own error constructor; Pay buyer uses the packed consumer's public client. |
| S | Selected official buyer → packed `createPayServer` | Actual native x402 fetch wrapper or Mppx client wrapper; seller facade owns its installed peers. A malformed-wire sender is explicitly a wire mutator, not a native wrapper claim. |
| X | Direct packed `create0xkeyFacilitatorClient` → scripted HTTPS facilitator | Selected native `FacilitatorResponseError`; actual public verify/settle/getSupported calls. Official resource/HTTP compositions explicitly configure upfront. |
| M | Direct packed `create0xkeyEvmChargeMethod` inside official Mppx | Selected native `Errors.PaymentError`, physical owner matching Mppx. Current same-owner/default, configured foreign current/N−1 and valid-but-wrong-owner controls are named separately below. |
| C | Packed public client callback/provenance subcase | Public client and public PayError owners only. Callback tests do not establish signed HTTP interoperability or durable restart by themselves. |

`B`/`S` never imply that the official client supplies durable recovery. For
official callers, the test application explicitly owns credential replay and
business idempotency. Count handler calls separately from economic and
application effects. For `B`, use the real key-backed AEAD store and fresh
buyer processes wherever pending/restart is asserted.

## All 19 aggregate families

The development-only S/wire slice implements six controls named in the table:
`both-credential-headers` (one native plus one explicitly synthetic header),
`selected-malformed-credential` (canonical encoding with `payload:null`), and
the credential/offer chain, asset, recipient and amount mismatch cases. Each
has an actual first-send mutator negative and a separate fresh native positive
calibration. It records preparse private arrivals separately from validated
operations and effects. This does not close any aggregate row: decoder-invalid
base64/JSON, temporal/unsupported authorization and the remaining owner/corpus
variants still require their own evidence. See the private README for the
one-family command and rejection-owner boundaries.

Subcase identifiers below are fixed semantic names, not pass labels. Record
each variant, condition, direction and owner individually. A positive
calibration is an actual successful invocation of the same measured operation,
not a literal zero counter or a previous artifact result.

| Family | Required subcases and directions | Required observations / applicability boundary |
| --- | --- | --- |
| `malformed-ambiguous-offer` | B: `header-invalid-base64`, `header-invalid-json`, `duplicate-incompatible-offers`, `unsupported-scheme`; S/wire: `both-credential-headers`, `selected-malformed-credential`. B: `request-body-read-failure`, `body-not-replayable`. | Invalid offers must stop before signing; invalid credentials stop before private settlement/handler. Distinguish syntactically malformed wire from a valid but policy-denied offer. Retain body capture timing and real call counts; do not call a manual mutator an official buyer. MPP also runs the selected malformed corpus in its separately named corpus rows. |
| `temporal-validity` | B: `expired-challenge`, `not-yet-valid-challenge` where that protocol carries challenge time; S/wire: `expired-authorization`, `future-authorization`, `inverted-validity-window`. | Use the protocol's actual time fields; x402 authorization time is not an invented signed-challenge field. Verify the canonical command is rejected before settlement/handler where the SDK validates it. Record actual rejection owner if the public low-level operation delegates validation. No out-of-range coercion or timeout-based expiry shortcut. |
| `network-mismatch` | B: `other-base-network-offer`, `unsupported-chain-offer`; S/wire: `credential-offer-chain-mismatch`; B/restart: `pending-open-other-network`. | No signature for rejected offers; no private settlement for an inconsistent credential; no signed send on incompatible pending profile. Never infer network from provider, nonce or receipt. |
| `asset-mismatch` | B: `non-usdc-offer`, `wrong-network-usdc`, `wrong-decimals`; S/wire: `credential-offer-asset-mismatch`. | Canonical USDC and its actual decimals remain fixed. Report whether a malformed field is rejected as syntax or policy. No asset substitution, private settlement or new signature after rejection. |
| `payee-mismatch` | B: `invalid-recipient-offer`; S/wire: `credential-offer-recipient-mismatch`; B/proof: `transfer-recipient-mismatch`, `calldata-recipient-mismatch`. | The public buyer policy has no independent recipient allowlist. An arbitrary different *valid* address is not assumed forbidden before signing. The offer freezes the recipient; credential/proof must match that frozen recipient. Separate pre-sign invalid-address rejection from post-sign proof mismatch and pending retention. |
| `amount-mismatch` | B: `above-ceiling`, `negative`, `non-integer-atomic`, `malformed-price`; S/wire: `credential-offer-amount-mismatch`; B/proof: `transfer-amount-mismatch`, `calldata-amount-mismatch`. C: `owned-host-policy`, `owned-amount-policy`, `forged-policy-error`. | Actual maxAmount/host policy, no invented payee policy. Invalid/excessive offers sign0; changed signed economics settle0 or proof rejection as appropriate. A forged callback error cannot select a trusted policy classification. |
| `unsupported-authorization` | B and S/wire: x402 `permit2`, `upto`, `unknown-required-extension`; MPP `session-intent`, `non-evm-method`, `unsupported-authorization-payload`. | No cross-scheme/protocol fallback. For the x402 2.23 and 2.22 owners, `permit2` and `unknown-required-extension` are distinct values of the required selector `accepts[].extra.assetTransferMethod`; the fixed unknown nonempty wire value is `future-transfer`. `upto` is the independent `accepts[].scheme` selector. These selectors are owned by the physical installed `@x402/evm@2.23.0` or `@x402/evm@2.22.0` graph selected by the row. The historical `unknown-required-extension` caseId is naming debt: it does **not** mean `PaymentRequired.extensions`, JSON Schema `required`, or arbitrary optional metadata. Apply rejection only to an unsupported value that selects the authorization mechanism. Every negative records the actual redirect-destination request count as zero. Keep the negative calibration target separate from the selector decoded from the transmitted credential; a positive calibration records no negative target and observes `exact`/`eip3009` from its real wire header. Record exact selected protocol/intent and operation reached. |
| `replay` | B: `same-process-replay`, `fresh-process-replay`; S: `direct-caller-identical-credential-replay`. | Stable credential/economic digest and private identity, economic effect1 and application effect1; actual handler count may exceed1. Official direct caller supplies the application idempotency layer. The fixture proves only its own scripted idempotency, not services DB uniqueness. |
| `settle-unknown` | B/restart: `accepted-503`, `accepted-disconnect`, `accepted-timeout`, `signed-500`, `signed-502`, `signed-599`, then `verified-resume`. S: `unknown-no-handler`. X/M: `owner-unknown` controls described below. | Freeze the signed request before send; same protocol/provider/network/credential after each indeterminate outcome; sign1/save1 across fresh buyers, no clear before receipt plus economic proof. Observe accepted request separately from scripted effect. No false402 accepted as safe pending compatibility. |
| `verify-settle-rejection` | X: `verify-positive`, `verify-4xx`, `verify-failed-result`, `settle-4xx`, `settle-failed-result`; B/S: `settlement-rejected-no-handler`; M: `command-4xx`, `command-failed-result`, `owner-rejected`. | MPP charge has no separate x402 verify endpoint: do not fabricate one. Its command rejection is its applicable operation. x402 direct verify calibration must really call verify; upfront happy verify0 alone is not calibration. Record typed/HTTP classification and no paid handler. |
| `supported-failure` | X/S x402: `supported-timeout`, `supported-invalid-json`, `supported-invalid-shape`. S MPP: the same failures on an **unsigned initial request to a default dual-protocol Pay seller**, plus `mpp-only-nondependency-positive`. | Default dual-protocol seller initializes x402 before producing its initial challenge; failure returns dependency502 before an MPP signature/settlement. Native MPP buyer is selected, sign0/settle0. MPP-only control has supported0 and succeeds. This is not MPP-owned support discovery, and signed MPP does not traverse it. |
| `fulfillment-failure` | S: `fulfillment-http-503`, `fulfillment-disconnect`, `fulfillment-timeout`, `fulfillment-unexpected-2xx`; each followed by `same-credential-retry`. B: `economic-success-handler-incomplete`. | Settlement can succeed while persistence/fulfillment remains incomplete. Only the documented fulfillment200 is acknowledgement. Retain attempted state and stable private identity hashes, actual handler/application effects, receipt/status and pending outcome. Never re-sign to repair fulfillment. |
| `receipt-absent-malformed` | B: `absent`, `invalid-base64`, `invalid-json`, `wrong-protocol-header`, `malformed-required-field`; S/M: `non2xx-handler-supplied-receipt-removed`. | Every invalid receipt keeps the same pending record and clear0. MPP removes manual success receipt on non2xx as well as avoiding automatic attachment. x402's official upfront receipt rule remains unchanged; do not import the MPP-only rule into x402. |
| `receipt-mismatch` | B: `wrong-receipt-network`, `wrong-receipt-transaction`; RPC proof: `wrong-chain`, `wrong-contract`, `wrong-payer`, `wrong-payee`, `wrong-amount`, `wrong-nonce`, `wrong-validity`, `wrong-call`, `missing-transfer`, `missing-authorization-used`, `noncanonical-block`, `failed-receipt`, `transaction-hash-mismatch`. | Mutate actual public receipt fields only where present; MPP does not invent x402 receipt network/payer fields. Other identity mismatch variants mutate chain proof against the frozen authorization. RPC and verifier must actually run; no clear and no new sign. Private paymentId is not a required standard receipt field. |
| `unverified-receipt` | B: `rpc-unavailable`, `rpc-invalid-response`, `audited-verifier-false`, `audited-verifier-throws`; C: `missing-verification-profile`. | No verification profile is a configuration rejection, not a paid wire outcome. Audited verifier rejection preserves pending; raw callback text/forged fields cannot change classification. Standard receipt plus matching full RPC proof is the separate positive calibration. |
| `standard-wire-receipt` | B/S: `official-decoder-positive`, `private-envelope-excluded`, `private-payment-id-excluded`; M: `direct-wrapper-2xx-positive`, `direct-wrapper-non2xx-negative`. | Actual native public decoder accepts ordinary fields. Private envelope/id and full raw receipt never enter final diagnostics. Protocol success receipt is not by itself proof of economic effect or application fulfillment. |
| `handler-failure` | S: `handler-throws`, `handler-500`, `handler-400`, `handler-404`, `handler-302`, with `handler-200` calibration; M: same statuses through direct receipt wrapping, including existing manual receipt. S: `fulfillment-failed-after-handler-failure`. | Observe response status, receipt presence, handler/application-effect counts and actual fulfillment state. MPP throw/5xx → FAILED; 3xx/4xx keep existing FULFILLED classification but no receipt. No business-effect claim from status alone. Redirect is observed at seller and denied by transport; no follow-up request. |
| `redaction` | B/S/X/M: `credential-stamp-secret-key-receipt-body-sentinels`; C: complete accepted R99 callback and R102 signer provenance/timing controls, each freshly run on the bound tar. Supervisor: `bad-ipc`, `coercible-control`, `stderr-secret`, `output-limit`. | Only allowlisted metadata/digests survive stdout/JSONL/sidecars. Preserve safe top-level public messages and non-enumerable original cause identity in private memory; do not classify private cause access as a defect. Never serialize the raw cause or secret-bearing stack. Negative controls must demonstrate a real rejection and cleanup, not merely scan an empty log. |
| `protocol-freeze` | B/S: `other-protocol-shaped-nonce`, `other-protocol-error-text`, `coincident-fields`, `opposite-challenge-after-signature`; B: `redirect-before-payment`, `redirect-after-payment`, `changed-body-on-resume`, `changed-request-binding`, `old-v3-binding`, `callback-signing-provenance`. | No guessing or post-sign protocol/provider/network switch. Redirect controls have a real potential destination listener whose request count remains0; no DNS/off-loopback fallback. Body and authenticated v3 bindings are checked before replay. R102 signer exceptions cannot become trusted policy or recovery verdicts. |

The private `final-7b` executable coverage currently includes the complete
`mppx-0.8.19-unsupported-authorization` and
`mppx-0.8.17-unsupported-authorization` catalogs: offer cases
`session-intent` and `non-evm-method`, plus wire case
`unsupported-authorization-payload`, each under import and require with a fresh
native positive calibration. Offer negatives must observe sign0/send0; the
wire negative signs the genuine official credential before the isolated
discriminator mutation and must be classified by the native server as an
invalid payload with charge/handler/economic effects all zero. Other MPP
families and the matrix remain unadmitted.

The private `final-7b` executable coverage also includes exactly the four
`supported-failure` rows for x402 2.23/2.22 and MPP 0.8.19/0.8.17. Each x402
row runs seller dependency timeout, invalid-JSON and invalid-shape controls
plus the corresponding direct public `getSupported()` controls, under import
and require. Each MPP row runs the three unsigned dual-seller dependency
controls plus the MPP-only nondependency positive, under import and require.
Every negative uses a fresh positive calibration and every observation binds
the row's installed physical owner. The MPP seller dependency remains x402
discovery owned; the MPP-only positive has zero support calls. This executable
does not admit any row, change the matrix, or broaden public behavior.

The private `final-7b` executable coverage additionally includes exactly the
four `handler-failure` rows for x402 2.23/2.22 and MPP 0.8.19/0.8.17. Each row
runs the seven closed handler/fulfillment-state cases under import and require,
for fourteen tuples. The first request is a native signed buyer operation; the
second request, where applicable, is the same captured credential retried by
the application in the same process. Observations retain the actual handler
status, receipt, settlement/economic identity, application effect,
fulfillment state and redirect-zero controls. This is not durable recovery or
re-sign evidence. The executable does not admit any row, change the matrix, or
broaden public behavior.

The private `final-7b` executable coverage additionally includes exactly the
four `fulfillment-failure` rows for x402 2.23/2.22 and MPP 0.8.19/0.8.17.
Each row runs HTTP 503, accepted disconnect, accepted timeout and unexpected
204 fulfillment outcomes under import and require, for eight tuples. Only an
actual HTTP 200 acknowledges fulfillment. The native signed first request is
followed by the same application-owned captured credential; observations bind
one economic and application effect, two settlement/handler/fulfillment
attempts, stable private identity, actual transport error and successful retry.
This is not durable buyer recovery or re-sign evidence. The executable does not
admit any row, change the matrix, or broaden public behavior.

The private `final-7b` executable coverage additionally includes exactly the
four `replay` rows for x402 2.23/2.22 and MPP 0.8.19/0.8.17. Each row runs the
two durable Pay-buyer replay cases, one official direct-caller captured-request
replay case, and the two ownership cases under import and require, for ten
tuples. Buyer replay proves one credential across same-process and fresh-process
resume, one economic effect, one application effect, and no re-sign. The direct
caller explicitly owns application retry and idempotency. The ownership cases
use the real atomic AEAD store. These fixtures establish their scripted effect
boundaries only; they do not establish production services database uniqueness,
admit a row, change the matrix, or broaden public behavior.

The private `final-7b` executable coverage additionally includes exactly the
four `standard-wire-receipt` rows for x402 2.23/2.22 and MPP 0.8.19/0.8.17.
Each row freshly runs the ordinary native decoder, private-envelope exclusion
and private-payment-id exclusion under import and require. MPP also runs the
physical owner's direct receipt wrapper for one 2xx positive and one non-2xx
negative. Each named case has its own invocation. Receipt success remains
separate from economic or application-effect claims. The executable does not
admit any row, change the matrix, or broaden public behavior.

The private `final-7b` executable coverage additionally includes exactly the
four `malformed-ambiguous-offer` rows for x402 2.23/2.22 and MPP 0.8.19/0.8.17.
Its closed paths are malformed offer headers, preflight body failures,
dual/duplicate offer selection, ambiguous or selected-malformed credential
wire behavior, and official credential decoder rejection with a fresh positive
calibration. This is 24 tuples for each x402 row and 22 for each MPP row. The
separately inventoried MPP selected-malformed corpus is not counted here. The
executable does not admit any row, change the matrix, authorize publication,
or broaden public behavior.

The four separate MPP `native-corpus` rows execute the fixed 104-case local
malformed-wire corpus for 0.8.19/0.8.17 under import/require. Final evidence
does not retain raw response bodies, headers, credentials or sentinels; it
retains public classifications, header names, counters and hashes. This corpus
is not an upstream suite and does not replace native-buyer, durable restart,
fault-owner or aggregate-row evidence.

The private `final-7b` executable coverage additionally includes exactly the
four `temporal-validity` rows for x402 2.23/2.22 and MPP 0.8.19/0.8.17.
Each x402 row runs the three actual EIP-3009 authorization windows under import
and require. Each MPP row adds the native expired-challenge control. The wire
sender first obtains the genuine official credential, changes only
`validAfter`/`validBefore`, and signs the changed typed data again with the same
real account and protocol codec. Therefore rejection is temporal evidence, not
a broken-signature substitute. The x402 facilitator owns the negative verify;
MPP rejects before private charge. Every negative has settle0, handler0 and
economic-effect0 plus a fresh native positive calibration. This executable
does not authorize publication, deployment, admission, or payment traffic.

The private `final-7b` executable coverage additionally includes exactly the
four `receipt-absent-malformed` rows for x402 2.23/2.22 and MPP 0.8.19/0.8.17.
Each row runs `absent`, `invalid-base64`, `invalid-json`,
`wrong-protocol-header` and `malformed-required-field` under import and
require, for ten tuples. The first native buyer signs and saves before send,
keeps the same pending record on receipt failure, and performs no negative
proof RPC or clear. A fresh buyer process reuses the same credential; the
positive receipt and four matching local proof reads all precede its one
clear. The observation binds the installed physical protocol owner, actual
receipt mutations, TLS and cleanup. This executable does not admit any row,
change the matrix, authorize publication, or broaden public behavior.

The private `final-7b` executable coverage also has a separate exact path for
the four `unverified-receipt` rows across x402 2.23/2.22 and MPP 0.8.19/0.8.17.
Each row runs `rpc-unavailable`, `rpc-invalid-response`,
`audited-verifier-false` and `audited-verifier-throws` under import and
require. RPC failures retain their three attempted negative proof reads;
audited verifier decisions make no RPC and retain one bounded callback verdict.
All failures preserve pending state and clear0. A fresh buyer reuses the same
credential, completes the four matching proof reads before clear, and records
the actual receipt mutation, physical owner, TLS and cleanup. This path does
not admit a row, change the matrix, authorize publication, or broaden public
behavior.

The private `final-7b` `receipt-mismatch` path covers the same four physical
owners. x402 runs all fifteen catalog cases; MPP runs fourteen and excludes
`wrong-receipt-network`, a field its public receipt does not carry. Each case
runs import and require, retains pending/clear0 on the applicable early or
four-read proof rejection, records the one changed proof field where present,
then uses a fresh buyer with the same credential for an unchanged four-read
proof before clear. It does not admit a row or authorize release activity.

The private `final-7b` executable coverage also includes the exact
`x402-2.23-network-mismatch` and `x402-2.22-network-mismatch` rows: offer cases
`other-base-network-offer` and `unsupported-chain-offer`, signed-wire case
`credential-offer-chain-mismatch`, and restart case
`pending-open-other-network`, each under import and require with a fresh native
positive calibration. Each row's offer and wire controls decode and encode
their actual installed x402 2.23 or 2.22 headers; restart preserves
byte-identical authenticated Sepolia pending state while rejecting a
Base-mainnet profile before new operation or I/O, then resumes the same
credential on the original profile. Each row must emit one complete
catalog-equal observation. These executable facts do not admit either row or
change the matrix.

The private `final-7b` executable also covers exactly the explicit physical
`x402-2.23-amount-mismatch` and `x402-2.22-amount-mismatch` rows: four official
Payment-Required amount mutations
(`above-ceiling`, `negative`, `non-integer-atomic`, `malformed-price`) and one
official Payment-Signature authorization-value mutation, each under import
and require. Its family-specific flag, CLI slice and runner do not reuse the
authorization or network-mismatch final channels. Offer negatives stop before
signing or I/O; the signed-wire negative has one sign/send and zero verify,
settle, fulfillment, handler and economic/application effects. Fresh native
positive calibrations are required. This executable does not admit either row or
alter the matrix.

The private `final-7b` executable additionally covers exactly
`x402-2.23-payee-mismatch` and `x402-2.22-payee-mismatch`: invalid recipient syntax in the official
Payment-Required `accepts.payTo` field and a different valid recipient in the
official Payment-Signature `payload.authorization.to` field, under import and
require. It does not invent a buyer payee allowlist. Offer rejection is
pre-sign; signed-wire rejection is pre-verify/settle/handler/effect, and every
negative has a fresh native positive calibration. This executable does not
admit either row or alter the matrix.

The private `final-7b` executable additionally covers exactly
`mppx-0.8.19-payee-mismatch` and `mppx-0.8.17-payee-mismatch`: invalid address
syntax in the official MPP Challenge `request.recipient` and a different valid
recipient in the official MPP Credential `payload.to`, each under import and
require. The rows share one closed MPP-only catalog but use separate explicit
profiles. Each row's installed `mppx@0.8.19` or `mppx@0.8.17` Challenge and
Credential codecs bind the transmitted values; digests prove that the complete
Challenge and every non-recipient payload member remain unchanged. The offer
negative is pre-sign, and the signed-wire negative is pre-verify, settlement,
fulfillment, handler and effect. This executable does not by itself admit
either row or alter the matrix.

The private `final-7b` executable additionally covers exactly
`mppx-0.8.19-amount-mismatch` and `mppx-0.8.17-amount-mismatch`: excessive,
negative, non-integer atomic and malformed price values in the official MPP
Challenge `request.amount`, plus a changed signed Credential `payload.value`,
under import and require. The rows share one closed MPP-only catalog but use
separate explicit profiles. Each row's installed `mppx@0.8.19` or
`mppx@0.8.17` Challenge and Credential codecs bind the transmitted values;
digests prove that the complete Challenge and every non-amount payload member
remain unchanged. Offer negatives are pre-sign, and the signed-wire negative
is pre-verify, settlement, fulfillment, handler and effect. Every negative has
a fresh native positive calibration. This executable does not by itself admit
either row or alter the matrix.

The private `final-7b` executable additionally covers exactly
`mppx-0.8.19-network-mismatch` and `mppx-0.8.17-network-mismatch` with that
catalog under import and require.
It enters through an MPP-only final role flag, CLI discriminator and runner;
the x402 `networkMismatchFinal` flag and runner reject MPP.
Each row's offer evidence is decoded and encoded by its installed
`mppx@0.8.19` or `mppx@0.8.17` Challenge codecs. Signed-wire evidence mutates
only the genuine Credential's independent
`source` network; Challenge and payload digests remain unchanged and native
server classification is `verification-failed`. An echoed Challenge chain
mutation is `invalid-challenge` and cannot substitute for the source-network
boundary. Restart retains byte-identical authenticated Sepolia state, rejects
the incompatible profile before new operation or I/O, then resumes the same
credential on the original profile. This does not admit either row or alter
the matrix.

## MPP owner controls inside the fault rows

The following additional approved gates have explicit aggregate homes; they
are not already established by the ten-stage UNKNOWN recovery sequence:

- `replay`: `single-client-singleflight` and `multi-client-atomic-claim` are
  separate subcases. The first measures one public client's coordination; the
  second races independent clients against the same actual atomic AEAD store.
  Exactly one durable claim and its credential may be sent. Competing clients
  may each attempt signing before the claim: there is no promised cross-client
  global signing lock. Retain actual sign/save-attempt/claim/send counts.
- `protocol-freeze`: `save-if-absent-false` and
  `save-if-absent-throws` require signed-send0; `durable-save-before-first-send-exit`
  terminates the first process only after authenticated bytes and key are
  durably saved, before its first signed send, then a fresh process resumes
  those exact bytes without signing. This crash window is distinct from
  acceptance followed by UNKNOWN. Also include `old-v2-pending` alongside
  `old-v3-binding`: both fail closed without migration, send or new signature.
- `malformed-ambiguous-offer`: `dual-valid-offer-prefer-x402` and
  `dual-valid-offer-prefer-mpp` are positive controls with two genuinely valid
  independently parsed offers. They prove configured preference selection;
  the incompatible duplicate-offer negative does not prove this behavior.

Each is driven through the same packed public client/role supervision and
records its own actual observations. Shared setup does not substitute one
subcase's evidence for another. These are planned gates until implemented.

For `settle-unknown` and `verify-settle-rejection`, execute the following
owner profiles in both entry conditions. Keep condition/package resolution
separate: an ESM exact version is not automatically the CJS constructor owner.

1. `default-current-same-owner`: Mppx and the omitted `paymentError` resolve to
   the same actual packed-consumer mppx0.8.19 owner. This is current-owner
   subcase evidence, not a claim that the N−1 fixture became a current peer.
2. `configured-foreign-selected-owner`: official Mppx and `Errors.PaymentError`
   both come from that row's separate0.8.19/0.8.17 physical fixture. Actual
   unknown/rejection HTTP, retry header, absent challenge/receipt and handler0
   are asserted; happy behavior cannot establish this boundary.
3. `wrong-owner-negative`: deliberately pair the selected foreign Mppx with
   the other valid physical constructor. Record actual owner inequality and
   failure behavior; shape validation is not expected to detect ownership.
   This negative control cannot establish compatible safe-pending behavior or
   waive the configured-owner assertion. Invalid constructor cases remain
   separate synchronous configuration controls with actual I/O0.

## Repair-regression binding and result rules

The accepted MPP boundary, R99 callback and R102 signer scenarios are listed
under the corresponding families above. Reuse the existing public probe logic
where appropriate, but each invocation must bind the new tar/consumer, actual
entry condition and retained fresh results. The old probe outputs are inputs
to understanding only. Do not relabel unsigned callback fixtures or manual
wire buyers as native wrappers or durable recovery.

Every row's eventual closed observation must enumerate its required subcase
IDs, actual direction/owner/condition, counts and evidence hashes; missing,
duplicated, unknown or substituted subcases cannot produce PASSED. Fault
expectations are protocol-specific and must be backed by real reachable API
behavior. An unexpected public runtime result freezes the failing evidence and
returns to the controller; this verification task does not repair it.

Services-owned uniqueness, migration and delivery invariants remain outside
this SDK harness. The controller's separate services checks do not turn SDK
scripted effects into database or production proof. All counters describe the
owned test system, with no external chain transactions or real payments.

## Separate signed credential decoder diagnostic

The closed `wire-decoder-controls` slice selects one native buyer/condition and
one of `credential-invalid-encoding` or `credential-invalid-json` per command.
It belongs to `malformed-ambiguous-offer` and does not replace payload-null or
claim complete family coverage. Invalid encoding is `%`; invalid JSON is the
canonical encoding of `{`. Pay's MPP raw guard precedes native HTTP malformed
classification; x402's core decoder owns the unpaid402 path and unapproved
warning risk. Negative effects and complete role streams must be checked before
a fresh, independent positive phase can start. Any forbidden output stops
variants; final diagnostics retain only closed metadata/digests. See the private
README for phase ownership and development-only limits.
