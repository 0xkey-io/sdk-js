# RN v3 native context capability gate

Status: **native operation-grant source candidate; RED for G5/G6. No RN v3 cold recovery or default Core adapter is enabled.**

## Bounded RED after independent source review

Run `node --test scripts/native-bound-context.red.mjs` explicitly. It is not
part of the normal sample test script. The local model freezes the
pre-operation-grant SQL contract to show why revision and token CAS alone are
insufficient. Its two CAS put cases, two old-caller remove/active cases and one
same-bridge grant race remain RED; its global-clear case is GREEN;
it is not a test of the updated Swift/Kotlin module or a device:

1. After key A/token A is removed and key B/token B is inserted, a still-live
   A context reads revision 3 and calls `putSession` for the absent A key with
   `expectedToken = null`. The typed API accepts A again. Exact prior-token
   checks protect replacement of an occupied key, but cannot authorize a new
   insertion when the key is absent. A tombstone for key A alone would leave
   other key names available to the stale caller.
2. The old context reads B's current token and latest revision, then calls
   `putSession` on B's occupied key with that exact `expectedToken` and a
   different `nextToken`. The frozen CAS model commits the replacement.
3. The old context reads B's current token and latest revision, then removes B
   or selects B active. The frozen CAS model commits both operations. The
   current native source closes both JS methods until a trusted host intent
   path exists; they are not accepted features.
4. A target-A context remains current when a host authorizes target B, since
   B only increments B's target generation. The original JS-facing `clearAll`
   could advance the global epoch and remove B. The JS bridge now rejects
   `clearAll`, and neither platform registers a JS native global-clear method.
   This closes the source-level cross-target clear route; product sign-out is
   not implemented or accepted.
5. Two JS wrappers share one live native bridge. An exact, single-use host put
   grant for the intended wrapper can be consumed by the retained old wrapper
   when it knows all operation arguments. Native instance, revision, prior
   token and digest binding do not distinguish those JS callers. The trusted
   host must keep the operation handoff and token unavailable to the old JS
   runtime or retire it before granting the new operation.

The P1 exit requires a host-issued, single-use native operation generation for
**every token-changing `putSession`**, including an absent-key insert and an
occupied-key replacement. The trusted host must bind its authorization event
to the exact target, owner, native runtime, session key, next-token digest,
expected revision, expected prior token and insert/replace purpose; native code
consumes that event in the same transaction as the write. Remove and active
selection need their own trusted host intent; their JS entry points currently
reject every call.
Retiring the prior generation invalidates all unconsumed old events.
No JS method may issue or refresh an event or derive one from SQLite counters.
The source candidate's native ledger stores an event ID, canonical target, owner,
bridge-instance identity, purpose, operation generation, expected revision,
expected prior token, insert/replace kind, session key, and token digest. The
native-only host entry point may be called only after a trusted login
completion and token-binding check. Every `putSession` compares
those fields, the current epoch/generation and unconsumed event ID under one
write lock, then mark the event consumed in the same transaction as the
session write. The candidate is fail-closed when no event exists. It consumes
an event even if the subsequent revision/token CAS conflicts. A later runtime
cannot reuse that event or manufacture another from a readable revision.
The current login flow has no trusted host handoff or native token validation,
so P1 stays RED. Source-level checks cannot replace durable native retirement
ordering or iOS/Android device evidence.

`authorizePutFromHost(targetKey, ownerId, expectedRevision, sessionKey, expectedToken, nextToken)` is a native-only
entry point on the exact module instance, absent from the Expo JS method table.
The trusted host must first verify the login completion, target/owner and token
binding, then call it once for the intended insert or replacement. It replaces
any pending put grant for that context. `putSession` hashes `nextToken` and
consumes the matching unspent row under the same SQLite write lock as the
revision, prior-token and session update. A caller cannot turn an intended
insert into a replacement, change the expected revision, or substitute the
prior token. Neither the host entry point nor the
grant ID is available from JS. The source cannot prove the trusted host event
or prevent a hostile JS caller on the _same live bridge_ from racing to consume
a grant whose token it already knows; that requires a protected native
handoff, token secrecy and controlled device testing. There is no caller of
`authorizePutFromHost` yet, so the sample fails closed for every put.

Global clear needs a distinct host sign-out authorization, not a target grant.
Both platform sources now provide a native-only `clearAllFromHost` method that
takes the database write lock, advances the global epoch, removes sessions,
and retires contexts before returning. No trusted host sign-out event calls it.
The proposed sign-out event carries a separate global operation generation;
the host-only call consumes it under the write lock before advancing epoch.
The product's logout/`clearAll` path remains a G5 prerequisite until that
trusted host lifecycle and iOS/Android device ordering are exercised.

The isolated sample now contains `modules/oxkey-bound-context`, an Expo local
module with Swift and Kotlin source, plus an explicit
`native-bound-context-expo.ts` consumer. Expo autolinking resolves the module
on both platforms. The JavaScript model/source contract tests are 9/9 GREEN and
the sample TypeScript check passes. Swift source parses. These checks do not
compile or run either native module, and no host has yet called the native
authorization entry points. The sample app does not import the consumer.

The v3 Expo JS method table exposes only `capability`, `read`, typed
`putSession`/`removeSession`/`setActiveSession`, and `retire`. Both
`removeSession` and `setActiveSession` currently reject every JS call because
no host intent issuer exists. The method table
exposes no arbitrary payload writer, enrollment, SQL connection, Keychain
value, or signing method. `authorizeFromHost` is a native method on the module instance,
absent from the JS method table and constants. A host must call it only after
its own trusted authorization event on the intended bridge instance. The
module assigns its own runtime ID and opaque handle. A different native
instance cannot use a copied handle; every operation checks the private
instance ID, exact target and owner, durable SQLite generation, and global
epoch. The native put transaction compares the record revision, operation
kind, exact session key, next-token digest and prior token. The
existing stale A cleanup and stale A replacement tests use A's old expected
token and fail to change newer B. The frozen model above also covers an old
caller that reads B's current token. Host-only
`clearAllFromHost` advances the global epoch and removes all session rows in
one native transaction; retirement
advances the target fence under the same database write lock. The JS wrapper
revokes its own access before awaiting retirement; its `clearAll` fails closed
without a native call. This typed consumer is deliberately
not a Core `AtomicBoundSessionStore` adapter.
The source uses a new v3 native database file and `0xkey-bound-context-v3`
protocol. It never imports the v2 native database, earlier numeric-fence v1
file or unbound v2 session data. Old v2 modules fail the v3 JS capability check.

Core's current synchronous `retireAuthWrites()` closes its JS access first;
the native `retire` method is reached by the later retirement hook. A hostile
old JS runtime that calls the native module directly during that gap is not
yet covered by this slice. Host lifecycle integration must revoke the native
instance promptly and gate replacement authorization on the durable barrier.

This is not a secure production storage path yet. The host authorization event
and its native-to-module handoff are still unimplemented. The sample still
contains `expo-sqlite`; arbitrary JS with direct access to the same sandbox
database could tamper with the plaintext fence/session tables or read newer
tokens and submit their exact values. Neither iOS Secure Enclave/Keychain nor Android Keystore protects
these rows here. The current JS-readable key stamper also remains outside
this module. A native-held integrity and confidentiality boundary, native key
use, controlled iOS/Android builds, and hostile-runtime tests are required
before any host should grant a context. Numeric SQLite fencing alone is not
treated as an authorization identity.

The earlier Expo 56 algorithm adapter still has no host-owned authorization
event. Its `sqlite-bound-session.ts` takes numeric
`epoch` and `generation` from JS. The last case in
`scripts/sqlite-bound-session.test.mjs` demonstrates that a retired runtime with
the database connection can read the next generation, supply it to the adapter,
and write again. The SQLite CAS tests prove the local transaction algorithm;
they do not establish an authorization identity.

## Required native boundary

The application host must select a canonical target and authorize a specific
native runtime instance after a fresh login or a host-approved cold recovery.
Only that host path may create an opaque context. A method callable by arbitrary
JS such as `issueContext(target, generation)` is insufficient, even if its
return value is random. The old runtime could invoke it after reading the new
numeric fence. Context acquisition must be unavailable from a retained old
bridge/runtime and must not accept a JS-supplied owner or authorization event.
The current login flow occurs in JS, so a host-owned authorization event and
its handoff are still missing.

Swift and Kotlin implementations must keep the active context, target, owner,
runtime identity, generation, and any key-use authority on the native side.
JS may hold an opaque handle for that runtime, but a copied handle must fail in
another runtime. Every read, compare-exchange, conditional delete, and signing
request checks the native context against the exact canonical target and current
durable fence. Native code owns the SQL connection and conditional transaction;
the SDK must not expose the raw connection to an old JS runtime. Keychain or
Android Keystore material stays native and is never returned to JS for this
path. Existing JS-readable Keychain access is not an authorization issuer.

Retirement must revoke the runtime locally at once, then take the native write
lock, finish or abort earlier native operations, durably retire that context,
and resolve its Promise only after the commit boundary. A write dispatched
before JS revocation may commit before the retirement transaction; none may
commit after that Promise resolves. Native replacement issuance waits the
same durable boundary across runtime and process restarts. Core's
`awaitAuthRetirement()` waits the hook in one JS runtime and gates replacement
`init()` there; it cannot establish the cross-process rule by itself. A failed
native retirement rejects the barrier and replacement init must fail closed.

The native transaction must cover the token, session key, active pointer,
target, owner, revision, generation, and global epoch together, even when
they occupy normalized tables. Conditional deletion checks the exact target,
owner, session key, token, and revision. Until key references
and key deletion share a safe native condition, retain the keypair on clear.
Never adopt unbound v2 records during cold start.

## RED before G5/G6

1. Build a controlled Expo development client containing the Swift and Kotlin
   module and a native host authorization path. Expo Go cannot exercise it.
2. On iOS and Android devices, use two native runtime/process instances. Have
   the old one read the latest numeric SQLite epoch and generation after
   retirement, then attempt context acquisition, read, write, and sign. Every
   attempt must be denied without access to the new opaque context.
3. Pause an already-dispatched native commit, call synchronous
   `retireAuthWrites()`, and start replacement `init()`. The new init must wait
   until `awaitAuthRetirement()` settles. Release the native operation; prove
   no old write commits after the retirement Promise resolves. Repeat after a
   process kill and restart.
4. Exercise two-connection revision conflict, `database is locked`, crash
   rollback, old-token conditional clear, `clearAll` epoch, exact target/owner
   mismatch, and v2 cold-start refusal on both platforms.
5. Confirm missing module, wrong capability version, and failed native
   retirement leave the default RN production adapter closed. Do not enable
   RN v3 cold recovery from Node SQLite or Metro-only results.

The host-owned event, protected native storage and key use, and device proof
remain prerequisites. The present native source is deliberately disconnected
from Core and cannot satisfy these device gates.
