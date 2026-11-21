# @0xkey-io/http

## 0.2.0

### Minor Changes

- [#25](https://github.com/0xkey-io/sdk-js/pull/25) [`7a09cd9`](https://github.com/0xkey-io/sdk-js/commit/7a09cd93c3dba20ac01e551196605e359dcaf20e) Author [@torbensen](https://github.com/torbensen) - Use the proof-aware signup V2 endpoint for Email OTP registration. Expose
  structured rate-limit errors and safely retry signed requests according to the
  server's Retry-After contract.

### Patch Changes

- [#57](https://github.com/0xkey-io/sdk-js/pull/57) [`9a9008c`](https://github.com/0xkey-io/sdk-js/commit/9a9008cd5926266e51e24eb53b29b2844282a224) Author [@torbensen](https://github.com/torbensen) - Use the canonical "0xkey" brand in user-visible strings. New passkeys added
  without a name are called `0xkey Passkey-<timestamp>` (existing passkeys keep
  their names), request errors read `0xkey error <code>: …`, and SDK warnings
  say "0xkey SDK". Public identifiers such as `ZeroXKeyError` and
  `ZeroXKeyProvider` are unchanged.

- [#46](https://github.com/0xkey-io/sdk-js/pull/46) [`94137a0`](https://github.com/0xkey-io/sdk-js/commit/94137a059397ae3d70b141173a8d3c844705ac71) Author [@torbensen](https://github.com/torbensen) - Expose the Turnkey-aligned MFA policy, session profile, credential binding, and
  `AUTHENTICATORS_NEEDED` identity contracts across every generated public client.
- Updated dependencies []:
  - @0xkey-io/api-key-stamper@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/api-key-stamper@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/api-key-stamper@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/encoding@0.1.1
  - @0xkey-io/api-key-stamper@0.1.1

## 0.1.0

Initial release.
