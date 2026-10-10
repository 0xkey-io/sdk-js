# Built-in Web Core / v3 credential path gate

Status: RED integration checkpoint. No built-in storage or stamper switch has
been made. The standalone test is
`mixed-core-bound.red.cjs`; it runs real `ZeroXKeyClient` instances in two
same-origin Chromium pages against IndexedDB, alongside the internal
`WebBoundCredentialStore` opt-in primitive.

## Reproduced behavior

The current output is:

```json
{
  "staleOwner": true,
  "orphanOwner": true,
  "bRetainedAfterAClear": true,
  "recreatedAfterFence": true,
  "ownerUnknownRetained": true,
  "coldRestored": true,
  "otherTargetSurvivesClearAll": true
}
```

The expected output differs at every field except
`bRetainedAfterAClear` and `ownerUnknownRetained`. In order:

1. The opt-in primitive claims target A's default session with public key K.
   Real Core restores it, replaces its token using
   `AuthStorageManager.storeSession`, then clears it. `KeyOwners` still
   references the original token and then has no corresponding session. The
   old single-store transaction bypasses owner maintenance. Target B's valid
   session sharing K remains present after A clears, which is the safe part of
   the current behavior.
2. A Core instance initialized before the primitive's global
   `clearAll(0)` commits a fresh session afterward. Its old
   `WebAtomicBoundSessionStore.transact` never checks `Meta.epoch`.
3. A cold Core instance on the same target restores that unowned, keyless
   session. `bindTarget` checks the target record but not same-file key and
   owner evidence.
4. The opt-in primitive refuses to clear that owner-unknown record, leaving it
   intact. This is the correct conservative behavior for old v3 data and
   potential V2 key material.
5. Core `clearAllSessions` clears only keys visible to the current client.
   A different target's record survives. This matches the current code's
   documented scope but does not satisfy a global sign-out promise.

## Why a session-only patch is unsafe

`WebStorageManager` injects `WebAtomicBoundSessionStore`, whose
`transact` opens a write transaction only on `BoundSessions`. The opt-in
primitive uses one transaction across `BoundSessions`, `KeyStore`,
`KeyOwners`, and `Meta`. Updating only `storeSession` would leave
`setStorageValue`, active-pointer writes, removals and clear calls able to
bypass epoch and ownership rules. Core also creates and signs Web API keys
through `IndexedDbStamper` in the separate `ZeroXKeyAuthV2/KeyStore`
database. Such keys have no pending claim or v3 owner record; the opt-in
`claimSession` cannot safely adopt them by matching public key or
organization ID.

## Required atomic cutover

1. Keep the built-in old path and internal opt-in path isolated while the
   migration is prepared. Legacy custom `AuthStorageManager` behavior stays
   unchanged. Never delete old V2 key material based on a v3 owner lookup.
2. Add a v3 keypair provider to the Web stamper with explicit pending claim,
   sign and discard operations. Its Core-facing flow identity must include
   the exact constructor target and storage generation. Map every Core route
   that creates, imports, rotates or discards API keys, including OAuth, OTP,
   signup and refresh, before switching the default. An old V2 key never
   becomes a v3 key merely because its public key matches a token.
3. The internal credential primitive now has `readVerifiedActive(target)`
   evidence: a four-store readonly snapshot, exact target generation and
   token/owner match, actual P-256 private-key proof, then a second readonly
   fence check after the asynchronous proof. Core cold restoration does not
   call it yet. The result is a historical verified snapshot, not a standing
   authorization to stamp or send; request use needs its own current-context
   guard. An older v3 target record without owner evidence remains stored but
   must not be published as authenticated.
4. Route all built-in Web session and active-pointer mutations through one
   credential coordinator: create pending key, claim or replace session,
   compare-set active pointer, conditional clear, and global clear. Each
   transaction checks `Meta.epoch` and the current target generation.
   Retiring a client must drain or fence its in-flight transactions before
   the next target is allowed to initialize.
5. At the cutover, bump the v3 IndexedDB schema version. Old bundles that
   open the prior version must fail closed with `VersionError`; already open
   connections must close on `versionchange`. The new bundle must not keep
   its own old single-store writer reachable for built-in Web storage.
6. Define `clearAllSessions` explicitly. A global local clear increments
   `Meta.epoch` and removes all v3 target records and owner rows in one
   transaction. Old V2 localStorage and the separate V2 private-key database
   need a separate migration/privacy checkpoint; local deletion cannot revoke
   already issued remote sessions or already held keys in old bundles.

The cutover needs a real dual-tab browser suite for replacement, pending
claim, last-reference deletion, stale epoch, cold restore, blocked schema
upgrade, request abort, and global clear. It also needs Core and React
regression suites. Until then, the RED test is a gate and the opt-in primitive
must not be wired into live built-in Core writes.

## Next cutover checkpoint (2026-09-29)

The five mixed Core failures still reproduce in a real two-page Chromium run.
The smallest safe Core writer update cannot be enabled alone: ordinary Web
`CrossPlatformApiKeyStamper.init()` selects `IndexedDbStamper`, whose
`createKeyPair`, `stamp`, `sign`, and `deleteKeyPair` all use the separate
`ZeroXKeyAuthV2/KeyStore` database. Core creates these V2 keys in passkey,
wallet, OTP, OAuth, refresh, and public `createApiKeyPair` flows. A v3 writer
must reject those keys because they have no target-bound pending claim or
same-file private key. Accepting them would recreate an unowned record;
rejecting them in the default path would make normal Web login fail after the
server has issued a session. Therefore the built-in Web manager and stamper
remain on their current path until they can switch together, with a schema
bump fencing old single-store writers.

The opt-in `clearSession` primitive now checks the exact target generation in
`Meta`, the session record, and the owner reference inside its four-store
transaction. The `claimSession` replacement check also requires the prior
owner reference to have the expected generation. A dual-connection Chrome
regression first showed an old generation deleting a later generation's
identical session key and token; it now rejects the stale clear, retains the
record and key, and permits the current generation's clear. This closes that
opt-in primitive defect; it does not make the mixed Core gate green.

### Isolated Core OAuth proof

`web-bound-oauth-optin.cjs` uses the internal
`enableWebBoundOAuthExperiment` hook, which is not exported from the package
index. A real Core instance creates a P-256 key through a v3 stamper, calls
`loginWithOauth` against a locally mocked Auth Proxy response, and claims the
returned token with its in-memory pending claim. A second same-origin Chrome
page constructs a new opted-in Core instance, verifies the persisted owner,
key and active token, restores it, and produces an API-key stamp using the
persisted non-extractable key. The test also confirms an ordinary unenabled
Core instance still writes V2 key material and that an unowned V2-backed
session is not restored by the opt-in path.

This is deliberately limited to OAuth, one active session, target generation
zero and an in-memory pending claim. External key import, pending-key discard,
signup/OTP/passkey/wallet/refresh rotation, cross-target session switching,
and global `clearAllSessions` are unsupported by the opt-in adapter. The
default Core path still uses the V2 stamper and old session writer. The five
mixed-path failures remain release blockers, and the opt-in proof does not
change the G5 decision.

The opt-in Core captures its constructor target before asynchronous init.
Its manager and stamper check that target before and after storage/signing
awaits; a detected drift permanently retires that Core instance. Each Core
issued HTTP handle also checks its own runtime config before stamping or
sending, and target-changing `createHttpClient` overrides fail immediately.
The Chrome proof covers immediate and in-flight init drift, held stamper/HTTP handles after config
mutation, an A→B→A observed drift, runtime HTTP config mutation, and drift
while WebCrypto signing is paused. This guard is opt-in only. Directly
mutating an object A→B→A without any operation in between cannot be observed
by a read-time guard; the default release path still requires its full C5
generation and compatibility gates.
