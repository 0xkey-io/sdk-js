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

- `src/process.mjs` launches trusted repository-owned cooperative fixtures in
  detached process groups with a strict allowlist environment, separate empty
  npm configs, offline package-manager flags, byte limits and a deadline.
  A fixture announces its actual versions and waits for the `start` message
  before I/O. The lifecycle is `spawned → identified → ready → observed →
completed → closed`; timeout/corrupt controls cannot pass. Cleanup covers
  ordinary exit, failure and deadline, including listening grandchildren.
  This is not an OS network sandbox or containment after killing the parent.
- `src/redact.mjs` accepts only closed JSONL event schemas: exact version
  metadata, numeric ports/counters and permitted SHA-256 digests. It retains
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
