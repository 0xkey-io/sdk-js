---
"@0xkey-io/core": patch
---

Correct why `loginWithOtp` does not fall back to Auth Proxy `otp_login_v2`
when Attested StampLogin is refused with HTTP 403 or an `ATTESTED_LOGIN_*`
reason (for example a user with an MFA policy). `otp_login_v2` checks the OTP
only and does not ask for the additional factors in the user's MFA policy, so
the SDK does not switch to it on its own; whether to offer it to such users is
the application's decision. Actions taken with a Session from `otp_login_v2`
are still checked against the user's MFA policy. Runtime behavior is unchanged.
