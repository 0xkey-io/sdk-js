# Example: `wallet-auth`

This example shows how to implement [external wallet authentication](https://docs.0xkey.io/sdks/react/using-external-wallets/overview) (e.g. MetaMask, Phantom, etc) with 0xkey using the [@0xkey-io/react-wallet-kit](https://docs.0xkey.io/sdks/react).

It contains two separate implementations:

- **without-backend** - Uses ZeroXKey’s managed [Auth Proxy](https://docs.0xkey.io/reference/auth-proxy) to securely handle sign-up and login flows with origin enforcement and centralized configuration — no backend required. Your frontend interacts directly with 0xkey.
- **with-backend** - Demonstrates how to run the same authentication flow through **your own backend**.

**Auth Proxy Highlights**

- No need to host or maintain your own authentication backend. The Auth Proxy is a managed, multi-tenant service that handles signing and forwarding authentication requests.
- Proxy keys are HPKE-encrypted inside ZeroXKey’s enclave and decrypted only in memory per request. Includes strict origin validation and CORS enforcement.
- Manage allowed origins, session lifetimes, email/SMS templates, and OAuth settings directly from the 0xkey Dashboard.
- The frontend calls Auth Proxy endpoints directly — no backend endpoints needed for OTP, OAuth, or signup flows.

**Custom Backend Highlights**

You could:

- Store and retrieve user data associated with 0xkey sub-organizations.
- Add custom validations, rate limiting, and logging.
- Enable 2/2 signing patterns where your application is a co-signer.
