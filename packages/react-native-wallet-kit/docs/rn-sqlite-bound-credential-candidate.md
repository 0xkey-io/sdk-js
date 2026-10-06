# RN bound credential SQLite candidate

Status: experimental package and algorithm candidate; C5 remains blocked. No
production Core default, cold restoration, or native build has changed.

## Verified boundary

The isolated Expo candidate pins Expo 56.0.22 and exact `expo-sqlite` 56.0.6
in its npm manifest and lockfile. It remains excluded from this SDK's pnpm
workspace and lockfile. The SDK Core package and Bare RN entrypoint do not
depend on `expo-sqlite`. The standalone
`packages/core/src/__tests__/rn-sqlite-capability.red.cjs` now passes its
package-graph prerequisites against the isolated npm lockfile and installed
module. It remains outside Jest discovery because package resolution does not
establish native transaction behavior.

`examples/authentication/captcha-rn-expo/sqlite-bound-session.ts` is an
explicitly injected experimental adapter. Its revision CAS, per-target
retirement fence, global clear epoch, rollback path, deletion ABA protection,
write-lock conflict, and stale-context reopen rejection pass eight local
`node:sqlite` tests through a two-connection wrapper. Run them with
`node --test scripts/sqlite-bound-session.test.mjs` from that example. The
wrapper checks the algorithm against SQLite, not Expo's iOS/Android native
module. A TypeScript-only fixture verifies that the candidate's `read` and
`transact` methods fit Core's `AtomicBoundSessionStore` interface. The adapter
is not wired into Core or default RN recovery. Its current tables contain only
the global epoch, per-target generation, and revisioned JSON records; they do
not implement schema-version negotiation or `KeyOwners` claims.

Opening the adapter now requires an expected target/epoch/generation supplied
by an independently trusted authorization flow. It rejects a missing fence or
one retained from before `retireTarget` or `clearAll`; it never silently adopts
the current database values as a new lease. **The SDK has no trusted fresh
authorization issuer or verifier today.** The numeric expected fence is not
itself an unforgeable capability: a stale JS runtime with direct database
access could read newer values and submit them. A test demonstrates that forged
newer values can reopen and write. Consequently these local tests establish
stale-value rejection only; they do not authorize fresh restoration
or close the old-runtime reopen threat in a deployed app. No helper in the
candidate issues a new lease from the database.

[Expo SDK 56 recommends `expo-sqlite` ~56.0.6](https://docs.expo.dev/versions/v56.0.0/sdk/sqlite/).
Its `withExclusiveTransactionAsync` uses the supplied transaction object,
commits or rolls back based on the callback result, and is available on iOS
and Android. The documentation says other writes may fail with “database is
locked” once it becomes a write transaction; it does not establish this SDK's
two-runtime retirement behavior or prove a pending JS abort cancels a native
commit. The API is not supported on Web.

## Narrow opt-in shape after package and device gates

An Expo controlled native build could inject a SQLite-backed
`AtomicBoundSessionStore` into an explicit RN capability, without changing
default Core or Bare RN behavior. One SQLite file would hold:

- `Meta`: schema version, global cleanup epoch, and per-target generation.
- `Sessions`: exact constructor target, session key, complete token, active
  pointer, and monotonic revision in one target record.
- `KeyOwners`: public key, pending claim IDs, and exact target/session/token
  references. This is ownership metadata, not a private key store.

Every mutation would use the transaction object from
`withExclusiveTransactionAsync`. The first statement must acquire the write
transaction; the same callback then checks epoch, target generation, record
revision, exact prior token and key ownership before updating the session and
owner rows. A mismatch is a conflict with no write. Retiring target A would
advance its generation in that file; B must wait for the retirement transaction
to finish before it may restore or sign. `clearAll` would increment the global
epoch and remove all bound session and owner rows in one transaction. Operations
created under an older epoch must reject. Legacy unbound v2 data is never
claimed from its organization ID.

Existing Keychain private keys are outside the SQLite transaction. Conditional
session removal must conservatively retain those keys until a separate proven
cleanup protocol exists. A SQLite owner row alone cannot make Keychain deletion
atomic. The app must fail closed if the native module, schema, or capability
handshake is absent; AsyncStorage must not act as a fallback CAS.

## Required RED-to-GREEN device matrix

1. Two independently opened SQLite connections in one JS runtime race
   session A and B writes to one target: one revision wins; the other returns
   conflict, without lost references.
2. Two JS runtimes or processes on each of iOS and Android race the same
   write. Verify native file locking and the observed callback/commit order.
3. Pause an A write after its first native statement, start retirement from B,
   then release A. B restore waits for the fence; no A write commits afterward.
   Repeat with a forced `database is locked` response.
4. Throw or kill the runtime between session and owner statements. On reopen,
   neither partial session nor partial owner change is visible.
5. Replace token A with B, then execute A's stale exact-token clear. B and its
   key owner remain. A pending claim keeps its key owner through other clears.
6. Commit `clearAll`, restart an old runtime, and attempt session, owner and
   active-pointer writes with the old epoch. All reject without recreating rows.
7. Cold start with a bound record from the same exact target restores only if
   the key capability and owner claim verify; different-target and unbound v2
   records fail closed.
8. Repeat package consumption in the controlled Expo build and Bare RN without
   Expo modules. The latter must remain on its existing fail-closed path.

The current SDK also has the AsyncStorage counterexamples in
`mobile-bound-session-capability-test.ts`. The Node SQLite tests do not close
the iOS/Android multi-runtime gate. In particular, Core's
`revokeAuthAccess()` is synchronous and currently supplies only JS
`AbortSignal`; it does not await the adapter's durable retirement transaction.
An already dispatched native transaction may commit after the JS abort and
before the retirement fence commits. Native build, cross-process ordering,
trusted fresh-authorization issuance, capability handshake, and Keychain
ownership/cleanup remain unverified. Default RN restoration remains disabled.
