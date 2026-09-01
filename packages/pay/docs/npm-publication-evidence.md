# npm publication evidence (internal release contract)

Owner: Pay SDK release maintainers. Schema v1. These are source expectations
and unverified registry observations, not an accepted PAY-TIP or a GA claim.
Local tests use synthetic data only. Actual publication, collection, upload,
export and cryptographic acceptance require separately authorized operations.

## Offline checked-artifact prerequisites

`node packages/pay/scripts/check-packed-artifact.mjs --pack-destination PATH`
retains its build, temporary public-manifest pack, exact source restoration,
all tar checks, both default-owner `npm ls` checks, ESM/CJS imports, both native
runtime smokes, both public TypeScript fixtures and compiler invocation, and
success-only `GITHUB_OUTPUT`. `--verify-only TARBALL` still checks only the tar;
it is not installation or original CLI evidence.

Before building, supply `PAY_ARTIFACT_NPM_CACHE` naming an existing separately
provisioned cache, plus explicit empty regular-file `NPM_CONFIG_USERCONFIG`
and `NPM_CONFIG_GLOBALCONFIG` paths. Lowercase npm spellings are supported;
if both cases are present they must agree. No tool install, resolver, online
fallback, `npm cache add`, account npmrc discovery, or credential input is
provided. Install subprocesses use a clean allowlist environment, offline
mode, disabled lifecycle scripts/audit/funding/update discovery, and strict
peers. Build preserves PATH/Corepack context. HOME/home/CODEX_HOME are not
reassigned. A trusted fresh Node invocation remains required: a child-env
allowlist cannot undo hostile code already executed by a parent Node preload.

The release-owned `scripts/fixed-consumer.mjs` independently pins the raw
manifest SHA256 `1f3543f2a003fc27902a0af42d9b36cee315f6d0d92a110f2f60a20d74595cac`
and lock SHA256 `2e0e1a8025e0168efd5c48b86f316ba59edc61dc7bb3a11572355638b057eb65`.
The existing templates stay in `internal/pay-conformance/fixtures/packed-consumer/`;
the private conformance adapter retains its stricter canonical ASCII bindings.
No harness/matrix code runs in the release checker. The 358-record graph has
only four mutable Pay slots: manifest file reference, root lock file reference,
installed Pay resolved reference and SHA512 SRI derived from actual tar bytes.
Source workspace versions and packed metadata must match that graph.

`offline-consumer.mjs` reads required cache content through the selected npm's
bundled `cacache.get.stream.byDigest`, the same verified-integrity lookup used
by pacote for resolved+integrity lock entries. Cache directory/index presence
is insufficient; content-only cache acceptance is covered by actual offline
`npm ci`. Only explicitly host-incompatible optional platform records can lack
cache content. Installed owners also permit the one pinned orphan
`@emnapi/runtime` only when its sole parent `@img/sharp-wasm32` is absent and
host-incompatible; emnapi cache bytes remain mandatory. All other installed
owners, lock-owned dependency metadata and exact Pay payload are verified.

After pack/restoration, a canonical owned temporary parent receives a new
consumer child. The exact manifest/lock hashes must survive
`npm ci --offline --ignore-scripts --no-audit --no-fund --strict-peer-deps`.
Tar/templates/graph are checked again before output. Spaces, Unicode, relative
and absolute destinations and different caller working directories remain
admitted; macOS temporary aliases are canonicalized for consumer bindings.
Control characters in artifact/output paths are rejected. No caller directory
is removed to satisfy the new-consumer rule.

Known tool contexts are local npm **11.4.2** and the existing publisher's npm
**11.5.1**, with SDK pnpm **10.6.3** and the public Node >=22.12 baseline retained.
Local verification records actual Node/npm/pnpm and platform identities; it
does not prove Linux/npm11.5.1 or Windows runtime support. Publisher workflows
are unchanged by this local tooling change. Their existing pnpm installation
does not provision the separate npm graph cache: future reviewed explicit
Linux/npm11.5.1 cache/config provisioning and the complete original CLI on that
context remain required before publisher readiness. Missing cache fails closed
before build; local success cannot waive that gate.

## Before publication: preserve the original

The dedicated publisher first runs the existing checked pack/install/import
gate. `prepare-npm-source-context.mjs` then reads that original tar as bounded
opaque bytes, never extracts or executes it, and publishes a new directory
outside the checkout containing exactly:

```text
pay-checked-package-v1/
  source-context.json
  package.tgz
```

The closed context has exactly `schemaVersion` (`pay-npm-source-context/v1`),
`package` (`@0xkey-io/pay`), `version`, `source` and `checkedTar`. The source
manifest must match its immutable Git blob, be private, and retain the existing
fixed name/repository/public-registry/next contract. Its exact version is used.
Tree bytes come from a bounded immutable commit object with replacement refs
and lazy remote object fetch disabled; no candidate executable is selected.

`source` has exactly `repository`, `server`, `event`, `ref`, `workflowRef`,
`runId`, `runAttempt`, `runner`, `requestedSha`, `runSha`, `workflowSha`,
`mainRef`, `mainSha`, and `treeSha`. The fixed identity is `0xkey-io/sdk-js`,
`https://github.com`, direct `workflow_dispatch`, `refs/heads/main`,
`.github/workflows/pay-publish.yml`, and `github-hosted`. Requested/run/workflow/
main SHAs are one full lowercase 40-hex commit; tree SHA is full 40-hex. The
positive run ID/attempt strings are canonical decimal, at most 20 digits.
Preparation uses the main tracking SHA already checked by GateP, without a new
fetch; GateP still freshly checks actual source/main immediately before publish.
No `GITHUB_*` variable is rewritten or missing coordinate inferred.

`checkedTar` contains exactly byte `size`, lowercase `sha1`, `sha256`, `sha512`
and one canonical SHA512 `integrity` SRI. The preceding checked-pack gate is
the package-content authority; preparation performs no second pack or install.
The preserved tar copy, publication input and later collector input must be
the same bytes. Preservation/upload failure prevents publication.

## Fixed public observations

For exact canonical semver `V` (at most 128 ASCII characters, each core number
at most nine digits), requests are restricted to `https://registry.npmjs.org`:

| Observation             | Fixed path                                 | Limit  |
| ----------------------- | ------------------------------------------ | ------ |
| Version metadata        | `/@0xkey-io%2fpay/V`                       | 2 MiB  |
| Opaque tar              | `/@0xkey-io/pay/-/pay-V.tgz`               | 10 MiB |
| Advertised attestations | `/-/npm/v1/attestations/@0xkey-io%2fpay@V` | 2 MiB  |

The metadata advertisement is mandatory. Only leading `@` or `%40` and scoped
separator `%2f` or `%2F` spelling variations are accepted in that advertised
path; the collector requests its own canonical URL and preserves the advertised
spelling. Raw URL comparisons reject credentials, ports, redirects, queries,
fragments, whitespace, backslashes, dot segments and alternate encodings before
normalization. `dist.signatures` is never a provenance fallback.

The internal HTTPS client uses explicit verified TLS for the fixed hostname
with the pinned Node runtime's bundled roots, a private agent, no proxy/config/
credentials/cookies, identity encoding and a total 30-second
deadline per request. HTTP 200, bounded headers, suitable JSON/gzip/octet-stream
content types and consistent declared/actual length are mandatory. Only status,
bounded Date/content-type and local observation time are recorded. They are
observations, never trusted signature time. There is no automatic retry loop.

Native TLS admission rejects unsupported runtime configuration **before**
constructing the agent or invoking the request. Any Node runtime flag or presence
(even an empty value) of `NODE_EXTRA_CA_CERTS`, `NODE_OPTIONS`,
`NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_USE_SYSTEM_CA`, `NODE_DEBUG`,
`NODE_DEBUG_NATIVE`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `SSLKEYLOGFILE`,
`OPENSSL_CONF`, `OPENSSL_CONF_INCLUDE`, `OPENSSL_MODULES`, or `OPENSSL_ENGINES`
fails with `PAY_NPM_RUNTIME_ENVIRONMENT`. The check uses both a module-entry
snapshot and current values; removing a variable after module entry cannot
enable capture. Explicit bundled roots alone do not stop Node's native
extra-CA discovery or raw native warnings, so unsupported inputs are rejected,
not cleared. Local regression tests use fresh subprocesses and real native TLS
contexts without sockets; rejection never reaches native context creation.

Both declared SHA1 and canonical SHA512 SRI must match recomputed tar bytes.
Registry tar bytes must also equal the retained checked tar **byte-for-byte**,
not just a supplied digest. Optional `gitHead` is accepted only as a matching
full lowercase source SHA. Absence is legitimate for npm's tarball publish path.

## Raw bundle and unverified npm profile

JSON parsing rejects duplicate decoded keys, invalid UTF-8, malformed Unicode,
nonfinite/unsafe integer values, trailing data, depth over 64, more than 100000
value tokens, keys over 4096 bytes and string tokens over 1 MiB. It preserves
primitive types and exact byte ranges, including multibyte prefixes/escapes.
The outer object contains only `attestations`: 1–8 entries, each exactly
`predicateType` and `bundle`. Each bundle is at most 1 MiB; the canonical base64
DSSE payload decodes to at most 256 KiB of strict JSON.

Bundle media types v0.1/v0.2/v0.3 are structural inputs only. Each has one DSSE
representation with in-toto payload type and 1–8 distinct nonempty base64
signatures, each at most 16 KiB. Unknown competing bundle/envelope signature
representations fail. Every retained entry has matching outer/payload predicate
and one matching PURL/SHA512 subject. Exactly one must be Statement-v1/SLSA-v1.
Other publish attestations remain indexed unverified data, never a SLSA substitute.

The selected npm profile requires build type
`https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1`,
workflow repository `https://github.com/0xkey-io/sdk-js`, exact main ref/publisher
path, one resolved source `git+https://github.com/0xkey-io/sdk-js@refs/heads/main`
with matching `gitCommit`, hosted builder
`https://github.com/actions/runner/github-hosted`, exact run/attempt invocation
URL and direct-dispatch event. Recorded repository/owner numeric IDs are only
observations, not independently trusted identity. The image producer's different
Actions profile cannot substitute for this npm profile.

The selected bundle is copied directly from its raw byte range, without JSON
serialization, canonicalization or an appended LF. A `.json` file containing
this single raw object is format-compatible with pinned gh 2.76.2's reader;
that statement does not establish actual npm cryptographic compatibility.
GateD must verify the exact bytes under independently approved tool/root/signer/
freshness policy. Security owners may additionally require a verified registry
publish attestation; this collector chooses no extra registry-key policy.

## Closed six-file receipt

```text
pay-npm-publication-receipt-v1/
  receipt.json
  receipt.sha256
  registry-metadata.json
  package.tgz
  registry-attestations.json
  provenance.bundle.json
```

The four observation files retain exact raw bytes. `receipt.json` contains:

| Field                                             | Meaning                                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`, `package`, `version`, `registry` | Fixed schema `pay-npm-publication-receipt/v1` and package/registry scope                                                                                        |
| `sourceExpectations`, `sourceContext`             | Complete source object above; original context-file size/SHA256                                                                                                 |
| `checkedTar`                                      | Original checked-tar identity above                                                                                                                             |
| `observations`                                    | Exactly metadata/tar/attestations; actual URL/status/Date/content-type/local observedAt/size/SHA256; tar adds SHA1/SHA512/SRI; attestations adds advertised URL |
| `files`                                           | Exactly the four retained raw files, each size/SHA256                                                                                                           |
| `attestations`                                    | Each index/predicate/raw-slice size/SHA256 and byte range                                                                                                       |
| `provenance`                                      | `verification: unverified`, `representation: raw-json-byte-slice/v1`, selected index/range/SHA256 and checked npm profile                                       |
| Optional `gitHead`                                | Matching registry observation only                                                                                                                              |
| Optional `checkedPackageArtifact`                 | Positive artifact ID/archive SHA256 with `meaning: transport-only`; both required together                                                                      |

Ranges are zero-based start-inclusive/end-exclusive byte offsets in raw
`registry-attestations.json`. Profile fields are `statementType`, `predicateType`,
`subject`, `buildType`, `workflow`, `sourceSha`, `sourceUri`, `builder`,
`invocationId`, `event`, and `observedGithubIds`. There is no `verified:true` or
release-acceptance field. `receipt.sha256` is SHA256 of final receipt bytes once,
formatted as `<hex>  receipt.json` plus LF; it has no self-reference.

Inputs are bounded regular non-executable single-link files with no symlink
path components; they are reread after observation to detect concurrent changes.
Output uses a new same-parent temporary directory, exclusive single-link files,
read-back byte checks, file/directory fsync and atomic rename under an exclusive
per-target lock. Completed data is read-only and never overwritten. The local
parent must be owned by the invoking user and not group/world writable; this is
a trusted local filesystem boundary, not protection against a malicious same-user
host. A stale lock is never automatically broken. Failure logs contain stable
`PAY_NPM_*` codes and phase only, not provider responses or candidate contents.

## Read-only recapture and retention

Run the **currently reviewed** collector from a trusted checkout, not code in
an old package, retained evidence or candidate source. Use an existing owned
non-group/world-writable output parent and a new absolute output path with no
symlink components. The production collector CLI requires the publisher's
existing Node 24.3.0 pin, including its bundled HTTPS roots; it does not select
or download that runtime. Launch a **fresh, directly invoked** trusted Node
process with no runtime flags and none of the unsupported environment inputs
listed above. Remove such inputs in the parent environment **before launching
Node**, not from an already-running process. JavaScript cannot undo hostile
pre-entry preloads, env-file processing, native initialization or their output;
the collector does not claim to sandbox those effects or recover a process whose
startup state was hidden before module entry. Independently preserve and validate
expected source/version and the original context/tar before invoking this command:

```sh
node packages/pay/scripts/collect-published-npm-receipt.mjs \
  --checked-tar /retained/pay-checked-package-v1/package.tgz \
  --source-context /retained/pay-checked-package-v1/source-context.json \
  --expected-version 1.0.0-rc.1 \
  --expected-source "$ORIGINAL_REVIEWED_SOURCE_SHA" \
  --output /owned-output/pay-npm-publication-receipt-v1
```

Optional `--artifact-id` and `--artifact-digest` add independently retained
transport coordinates, not provenance. There are no endpoint, CA, provider,
executable, fake-verifier or test-mode CLI flags. The three required trusted
code files are `collect-published-npm-receipt.mjs`, `npm-receipt-data.mjs`, and
`npm-receipt-json.mjs`; preserve their relative paths and reviewed commit/file
hashes when distributing them. They require only Node built-ins and the SDK's
Apache-2.0 license, not candidate npm code or dependencies.

Recapture never publishes, installs, builds, packs, executes payload scripts,
changes tags or requires current main equality. GateD separately checks source
reachability and signatures. Lost original tar/context blocks strict recovery;
a rebuilt tar cannot be called the original. Do not automatically rerun the
publisher after partial external success.

Both workflow uploads pin `actions/upload-artifact` v4.6.2 (MIT), use full
source/run/attempt names, fail on missing files, prohibit overwrite and retain
90 days. Artifact ID/archive digest are transport metadata. Export/access/
durable retention require an external owner before GA; neither runner storage
nor an expiring Actions artifact satisfies permanent evidence custody.

The fixed publisher validator closes the entire top-level and publish-job key
sets, exact permissions and 30-minute timeout as well as each complete step.
Job outputs, container/services, matrix/strategy, defaults, concurrency and other
unreviewed execution contexts are rejected. Only the three named preparation,
publication and collection steps consume the checked tar output; no additional
job-level consumer is permitted. This is a bounded workflow contract, not a
generic YAML/shell security analyzer.
