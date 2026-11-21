---
"@0xkey-io/core": patch
---

`signUpWithOauth` now keeps the OAuth providers passed in
`createSubOrgParams.oauthProviders` and puts the provider of the current sign-in
first, instead of replacing the list with that single provider.
