---
"@0xkey-io/crypto": minor
"@0xkey-io/core": minor
"@0xkey-io/sdk-types": patch
---

Add remote attestation verification for enclave boot proofs, independent of app proofs. `@0xkey-io/crypto` gains `verifyBootProof` (attestation chain + `user_data` binding + PCR comparison + quorum multi-sig verification against a pinned `manifestSet` trust anchor) along with borsh decoders for QOS manifest/manifest-envelope types (`decodeVersionedManifest`, `decodeVersionedManifestEnvelope`) and the production quorum trust anchor (`PRODUCTION_QUORUM_MANIFEST_SET`). `@0xkey-io/core` adds `fetchLatestBootProof` / `verifyLatestBootProof` client methods that fetch an app's live boot proof from the Coordinator and verify it end-to-end, letting callers confirm that the pivot binary running in a live enclave matches a manifest approved by 0xkey's quorum. `@0xkey-io/sdk-types` gains the corresponding `FETCH_LATEST_BOOT_PROOF_ERROR` / `VERIFY_LATEST_BOOT_PROOF_ERROR` error codes.
