# @0xkey-io/core

A core JavaScript web and React Native package for interfacing with 0xkey's infrastructure.

If you're using React, please use [`@0xkey-io/react-wallet-kit`](https://www.npmjs.com/package/@0xkey-io/react-wallet-kit) instead.

To learn how to use `@0xkey-io/core`, check out [our docs!](https://docs.0xkey.io/sdks/typescript-frontend)

## TypeScript support

Requires TypeScript 5.4 or newer with `"moduleResolution": "bundler"`. `node16`/`nodenext` resolution is not supported; see [TypeScript Support](https://github.com/0xkey-io/sdk-js#typescript-support).

## OTP login and the `otp_login_v2` fallback

`loginWithOtp`, and the `completeOtp` and `signUpWithOtp` flows that call it,
sign `stamp_login` with an Attested stamp (`X-Stamp-Attested`) made by the local
key bound to the verification token. When the server cannot take Attested
stamps, the login is retried once through Auth Proxy `otp_login_v2`, with a raw
P-256 client signature by the same key over the `USAGE_TYPE_LOGIN` message from
`getClientSignatureMessageForLogin`.

The fallback is deliberately narrow. It happens only when `stamp_login` fails
with:

- HTTP 401 whose body is not JSON (a gateway that does not know
  `X-Stamp-Attested`);
- HTTP 503, or an error reason `ATTESTED_STAMP_NOT_ENABLED`;
- HTTP 404 or 501.

It never happens on HTTP 403 (whatever the reason), on an `ATTESTED_LOGIN_*`
reason, on any other `ATTESTED_STAMP_*` reason, on a JSON 401, on other statuses
or on network errors. Those errors are thrown as before. In particular, a login
refused because the user has an MFA policy is not retried through
`otp_login_v2`: that login checks the OTP only and does not ask for the
additional factors in the user's MFA policy, so whether to offer it to such
users is the application's decision. Actions taken with a Session obtained
through `otp_login_v2` are still checked against the user's MFA policy.

The fallback also requires a configured Auth Proxy (`authProxyUrl` and
`authProxyConfigId`) and no `sessionProfileId`, which `otp_login_v2` cannot
honour. A Session obtained through it lasts as long as the Auth Proxy
configuration says; `expirationSeconds` does not apply.

Failed requests now keep their HTTP status: `ZeroXKeyRequestError` carries
`status` for JSON error bodies, and other bodies throw `ZeroXKeyHttpError` with
`status`, `statusText`, `retryAfter` and a short `bodySummary`.

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
