# @0xkey-io/core

A core JavaScript web and React Native package for interfacing with ZeroXKey's infrastructure.

If you're using React, please use [`@0xkey-io/react-wallet-kit`](https://www.npmjs.com/package/@0xkey-io/react-wallet-kit) instead.

To learn how to use `@0xkey-io/core`, check out [our docs!](https://docs.0xkey.com/sdks/typescript-frontend)

## API key retention migration note

Automatic key sweeping has been narrowed to conservative retention. Keys that are
pending session persistence or have been transferred to completion, callbacks, or
MFA processing are preserved; absence from the session index is not treated as
proof that a key is unused. The deprecated `clearUnusedKeyPairs()` compatibility
method is therefore a no-op.

Default core Web and React Native storage now performs a one-time local reset
before authentication initialization completes. Existing users must log in again.
This irreversibly deletes identifiable old SDK authentication keys and sessions;
rolling back the package cannot restore them. It does not revoke remote sessions,
delete accounts, wallets or assets, or erase Passkeys and external wallets.

New authentication uses isolated v2 session and key namespaces. Logical custom
session names returned to callers and wallet cache writes remain unchanged. Unknown
legacy records, unassociated unprefixed native keys, and orphaned Web keys are
retained. Old prefixed SDK native keys are deleted by their exact service names.
Standalone sdk-browser session/client records and its fixed IndexedDB
keypair are outside this reset. Unnamespaced historical provider PKCE values are
also retained because their SDK ownership cannot be proved.

Call and await `client.init()` before using authentication APIs or creating HTTP
clients. Concurrent calls share initialization; a failure blocks authentication
and allows retry; successful initialization is idempotent. Constructor injection
or assigning `httpClient` does not bypass initialization. Configuring an MFA handler
before initialization remains supported.

Old binaries may continue writing their old namespaces; the new core never imports
those records. Already-held signing objects are not revoked. Cross-tab safety for
new data comes from separate generations, not a cross-tab lock. Legacy custom
records are re-read before deletion, but get/remove storage cannot guarantee an
atomic comparison against concurrent old application writes. This change does not
add periodic garbage collection or claim that a live rollout has occurred.
