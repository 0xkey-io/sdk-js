---
"@0xkey-io/core": patch
"@0xkey-io/http": patch
"@0xkey-io/sdk-types": patch
"@0xkey-io/sdk-browser": patch
"@0xkey-io/sdk-server": patch
---

Sync generated clients to the Services public OpenAPI at `4694398` and expose
webhook endpoint CRUD (`createWebhookEndpoint`, `updateWebhookEndpoint`,
`deleteWebhookEndpoint`, `listWebhookEndpoints`), OIDC provider management
(`createOidcProvider`, `updateOidcProvider`, `deleteOidcProvider`,
`getOidcProviders`), `listSendTransactions`, and `listGasSponsorshipUsage`.
Auth proxy enable/update intents now carry their typed security transition
fields.
