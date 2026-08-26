# @0xkey-io/pay

## 1.0.0-rc.1

- Replace the pre-GA callable buyer with `createPayClient()` and explicit
  network, policy, durable recovery, and receipt-verification configuration.
- Add stable structured `PayError` fields and redacted pending summaries.
- Bind pending-payment v3 records to the stable protocol id,
  `pay-client-v1` adapter revision, normalized EIP-3009 Economic Effect, and
  exact authenticated request. Older rc.6-shaped v3 records fail closed and
  are never upgraded or re-signed.
- Remove root upstream x402/MPP wire-type exports and the pre-GA in-memory,
  manual pending export, and callable fetch surfaces.

## 0.3.0-rc.6

- Treat both `https://api-pay.0xkey.io` and
  `https://api-pay.staging.0xkey.io` as canonical Pay API origins. Both add the
  selected Base network channel and accept only the exact raw root or exact raw
  selected-channel URL before a request is signed or sent.
- Reject both Production and staging Pay website origins as facilitator bases.
  Explicit third-party and self-hosted facilitator URLs remain supported.

## 0.3.0-rc.5

- Repair the npm artifact so workspace dependencies are replaced with published
  versions before release. The publish workflow now verifies, installs, imports,
  and publishes the same `pnpm pack` tarball.
- Mark `0.3.0-rc.4` as not installable outside the SDK workspace because its
  published manifest contains literal `workspace:*` dependencies. This release
  supersedes rc.4.

## 0.3.0-rc.4

- Use `https://api-pay.0xkey.io` as the public Pay API origin. The product
  website `pay.0xkey.io` is rejected as a facilitator base URL.

## 0.3.0-rc.3

- Replace the implicit `production | sandbox` switch with required CAIP-2
  `network`: Base mainnet (`eip155:8453`) or Base Sepolia (`eip155:84532`).
- Route Seller and Admin calls through the matching `/base-mainnet` or
  `/base-sepolia` Pay channel. The public Pay origin rejects every other path;
  custom test origins remain available.
- Bind durable buyer recovery records to the selected network. Pending-payment
  format v3 rejects cross-network restore before sending the credential.
- Keep one organization, API-key model, and SDK surface across both networks;
  no Sandbox workspace or compatibility branch is introduced.

## 0.3.0-rc.2

- Add native x402 v2 and MPP `evm/charge` buyer and seller flows.
- Add Express, Hono, Next/Fetch, and admin entry points.
- Settle before the merchant handler and return a normalized receipt.
- Add X-Stamp V2 request binding and safe buyer limits.
- Save signed requests in an atomic, encrypted and authenticated store before
  sending; unknown results resume the same credential and never sign a new one.
- Pin `mppx@0.8.17` and official `@x402/*@2.22.0`; protocol fallback is allowed
  only before a credential is signed.
- Remove the unused pre-release `Pay.client`, `createPayClient`, paywall helper,
  and lowercase payment-state compatibility surface. No real x402 or MPP
  customer used these interfaces.
- Bind the Admin client to one organization, add canonical protocol and digest
  fields, and remove the fixed payment `direction` field and tenant
  relayer-balance interface. Shared relayer data is internal operations data.
- Make public Pay server and Admin calls X-Stamp-only, preserve HTTP status on
  non-JSON gateway errors, and keep structured unknown 503 recovery data.
- Bind ordinary x402 and MPP receipts to the full pending EIP-3009 Economic
  Effect with Base RPC proof. The buyer checks the transaction input, canonical
  USDC `Transfer` and `AuthorizationUsed` events, successful receipt, and block
  before clearing durable recovery state. Ordinary official x402 sellers do
  not need a 0xkey extension.
- Require a production-grade Base RPC, or an injected receipt verifier, before
  a production buyer can sign. Base public RPC is sandbox-only.
- Keep the buyer signer seam to `address + signTypedData` instead of exposing
  the full Viem `Account` type. This lets the 0xkey TEE wallet adapter and local
  accounts from compatible Viem minors compile against the same Pay Interface.

## 0.2.0

### Minor Changes

- [#1](https://github.com/0xkey-io/sdk-js/pull/1) [`e39edd1`](https://github.com/0xkey-io/sdk-js/commit/e39edd174891264eab4cb96059178570f6242db4) Author [@torbensen](https://github.com/torbensen) - Add X-Stamp (API key) auth to the Pay client for the public pay-gateway.

  `createFacilitatorClient` / `createPayClient` now accept a `stamper`. In stamper
  mode, `verify`/`settle` embed `organizationId` in the signed request body and
  send an `X-Stamp` header computed over those exact bytes; org-scoped reads sign
  an empty body (org travels in the path). Bearer + `x-0xkey-organization-id`
  remains for the internal facilitator. Also adds keyset pagination (`after` /
  `nextCursor`) and payment list filters.

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/viem@0.1.3
  - @0xkey-io/http@0.1.3
