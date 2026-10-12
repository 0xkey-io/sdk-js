---
"@0xkey-io/react-wallet-kit": patch
---

`handleAddPasskey` no longer leaves an unhandled promise rejection when adding
the passkey fails (for example, a name with characters outside the allowed
set). The error still rejects to the caller, and the success page is shown
only after the passkey is added.
