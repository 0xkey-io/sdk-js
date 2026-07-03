# @0xkey-io/pay

## 0.2.0

### Minor Changes

- [#1](https://github.com/0xkey-io/sdk-js/pull/1) [`e39edd1`](https://github.com/0xkey-io/sdk-js/commit/e39edd174891264eab4cb96059178570f6242db4) Author [@torbensen](https://github.com/torbensen) - Add X-Stamp (API key) auth to the Pay client for the public pay-gateway.

  `createFacilitatorClient` / `createPayClient` now accept a `stamper`. In stamper
  mode, `verify`/`settle` embed `organizationId` in the signed request body and
  send an `X-Stamp` header computed over those exact bytes; org-scoped reads sign
  an empty body (org travels in the path). Bearer + `x-0xkey-organization-id`
  remains for the internal facilitator. Also adds `payments.gasPayerBalance`,
  keyset pagination (`after` / `nextCursor`), and the `network` / `direction` /
  `address` / `createdAfter` / `createdBefore` list filters.

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/viem@0.1.3
  - @0xkey-io/http@0.1.3
