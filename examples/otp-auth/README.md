# Example: `otp-auth`

This example shows how to implement [email OTP authentication](https://docs.0xkey.com/authentication/email) with ZeroXKey using the [@0xkey-io/react-wallet-kit](https://docs.0xkey.com/sdks/react).

It contains two separate implementations:

- **without-backend** - Uses ZeroXKey’s managed [Auth Proxy](https://docs.0xkey.com/reference/auth-proxy) to securely handle sign-up and login flows with origin enforcement and centralized configuration — no backend required. Your frontend interacts directly with ZeroXKey.
- **with-backend** - Demonstrates how to run the same authentication flow through **your own backend**.

**Auth Proxy Highlights**

- No need to host or maintain your own authentication backend. The Auth Proxy is a managed, multi-tenant service that handles signing and forwarding authentication requests.
- Proxy keys are HPKE-encrypted inside ZeroXKey’s enclave and decrypted only in memory per request. Includes strict origin validation and CORS enforcement.
- Manage allowed origins, session lifetimes, email/SMS templates, and OAuth settings directly from the ZeroXKey Dashboard.
- The frontend calls Auth Proxy endpoints directly — no backend endpoints needed for OTP, OAuth, or signup flows.

**Custom Backend Highlights**

You could:

- Store and retrieve user data associated with ZeroXKey sub-organizations.
- Add custom validations, rate limiting, and logging.
- Enable 2/2 signing patterns where your application is a co-signer.
