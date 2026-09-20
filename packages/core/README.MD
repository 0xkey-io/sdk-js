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

A one-time reset for SDK-owned data created by older releases is being delivered
separately. This package change does not implement that migration, future garbage
collection, or claim that a live rollout has occurred.
