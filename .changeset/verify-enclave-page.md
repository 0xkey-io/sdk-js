---
"@0xkey-io/react-wallet-kit": minor
---

Add `handleVerifyEnclave` + `VerifyEnclavePage`: a standalone, visual "verify enclave identity" flow using `verifyLatestBootProof`, independent of App Proofs. Unlike `handleVerifyAppProofs` (which requires an App Proof to already exist), this can be triggered any time to show end users that the live enclave running a given app (e.g. "signer") matches a manifest approved by 0xkey's quorum multi-sig — including a visible failure state (previous verification UI silently closed on error).
