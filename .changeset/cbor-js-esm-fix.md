---
"@0xkey-io/crypto": patch
---

Fix `cbor-js` interop under Node's native ESM loader: `verifyBootProof`/`verifyAppProof` previously threw `CBOR.decode is not a function` when the published `.mjs` build was imported directly in Node (bundler-based consumers were unaffected).
