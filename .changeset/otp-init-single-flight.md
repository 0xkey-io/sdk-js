---
"@0xkey-io/sdk-types": minor
"@0xkey-io/core": minor
"@0xkey-io/react-wallet-kit": minor
---

Prevent duplicate OTP sends and surface the server's resend cooldown.
`initOtp` now shares one in-flight request between concurrent calls for the
same contact and Auth Proxy target. A refused send is raised as
`ZeroXKeyRateLimitError` with code `OTP_RESEND_COOLDOWN` or
`OTP_INIT_RATE_LIMITED` and `retryAfterSeconds` taken from `Retry-After`.
The wallet kit disables OTP entry buttons while a send is in flight, counts
down before Resend is enabled (60 seconds, or the server's wait), and shows
the cooldown message.
