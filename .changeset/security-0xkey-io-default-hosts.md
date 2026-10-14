---
"@0xkey-io/react-wallet-kit": patch
---

Security: stop defaulting to hosts on a third-party domain that 0xkey does not
own. Without `importIframeUrl` / `exportIframeUrl`, wallet import and export
load `https://import.0xkey.io` and `https://export.0xkey.io`, and the package
depends on `@0xkey-io/core@0.2.1`, whose API fallback is
`https://api.0xkey.io`. Nothing else changes; apps that configure these values
explicitly are unaffected.
