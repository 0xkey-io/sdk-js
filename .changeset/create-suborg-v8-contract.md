---
"@0xkey-io/core": patch
"@0xkey-io/sdk-browser": patch
---

Upgrade browser/core `createSubOrganization` clients to the current V8 activity
contract and defensively flatten newer versioned result keys from completed
activities. The server SDK and shared types were released separately as the
tenant hotfix.
