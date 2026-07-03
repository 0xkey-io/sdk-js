---
"@0xkey-io/crypto": minor
"@0xkey-io/core": patch
---

`verify(appProof, bootProof)` now delegates its boot-proof checks to `verifyBootProof`, closing a security gap: it previously only checked the AWS attestation chain and `user_data`/manifest binding, but never checked PCR values or quorum multi-sig approvals — so a manifest that was never approved by 0xkey's quorum (or that declared different PCRs than what's actually running) would still pass. `verify()` now accepts an optional `anchor` parameter (defaults to `PRODUCTION_QUORUM_MANIFEST_SET`, same as `verifyBootProof`), and `@0xkey-io/core`'s `verifyAppProofs` accepts and forwards the same `anchor` option.
