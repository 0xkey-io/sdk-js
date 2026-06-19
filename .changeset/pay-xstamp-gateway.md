---
"@0xkey-io/pay": minor
---

Add X-Stamp (API key) auth to the Pay client for the public pay-gateway.

`createFacilitatorClient` / `createPayClient` now accept a `stamper`. In stamper
mode, `verify`/`settle` embed `organizationId` in the signed request body and
send an `X-Stamp` header computed over those exact bytes; org-scoped reads sign
an empty body (org travels in the path). Bearer + `x-0xkey-organization-id`
remains for the internal facilitator. Also adds `payments.gasPayerBalance`,
keyset pagination (`after` / `nextCursor`), and the `network` / `direction` /
`address` / `createdAfter` / `createdBefore` list filters.
