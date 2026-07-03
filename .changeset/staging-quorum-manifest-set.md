---
"@0xkey-io/crypto": patch
---

Add `STAGING_QUORUM_MANIFEST_SET`, a public trust anchor for verifying boot proofs from 0xkey's `staging-default` enclave environment (analogous to the existing `PRODUCTION_QUORUM_MANIFEST_SET`, but pinned to staging's own, separate quorum ceremony). Pass it explicitly to `verifyBootProof`/`verify` when verifying non-production enclaves.
