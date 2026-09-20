# @0xkey-io/react-native-wallet-kit

The easiest and most powerful way to integrate ZeroXKey's Embedded Wallets into your React Native applications.

## Getting started

To learn how to setup your ZeroXKey organization and configure the Auth Proxy, check out our Getting Started guide for React Native.

## Installation

You can use `@0xkey-io/react-native-wallet-kit` in any React Native app (Expo or bare).

```bash
npm install @0xkey-io/react-native-wallet-kit
```

This package requires the following peer dependencies:

```bash
npm install react react-native react-native-passkey react-native-inappbrowser-reborn react-native-gesture-handler react-native-safe-area-context react-native-svg @react-native-async-storage/async-storage react-native-get-random-values react-native-url-polyfill buffer
```

## Quick Start

### Provider

```tsx
import { ZeroXKeyProvider } from "@0xkey-io/react-native-wallet-kit";

export default function App() {
  return (
    <ZeroXKeyProvider
      config={{
        organizationId: "your-organization-id",
        authProxyConfigId: "your-auth-proxy-config-id",
      }}
    >
      {/* Your app content */}
    </ZeroXKeyProvider>
  );
}
```

> If you're using Expo, ensure polyfills are imported early (e.g., in your root layout) and `Buffer` is defined:
>
> ```tsx
> import "react-native-get-random-values";
> import "react-native-url-polyfill/auto";
> import { Buffer } from "buffer";
> (global as any).Buffer = (global as any).Buffer || Buffer;
> ```

## Quick authentication

```tsx
import { useZeroXKey, AuthState } from "@0xkey-io/react-native-wallet-kit";

function LoginButton() {
  const { loginWithPasskey, loginWithOtp, handleGoogleOauth } = useZeroXKey();

  return (
    <>
      <Button title="Login with Passkey" onPress={() => loginWithPasskey()} />
      <Button
        title="Login with Email OTP"
        onPress={async () => {
          // initialize + verify OTP as needed, then:
          await loginWithOtp({ email: "user@example.com", otp: "123456" });
        }}
      />
      <Button title="Login with Google" onPress={() => handleGoogleOauth()} />
    </>
  );
}
```

## OAuth client configuration

OAuth providers accept Turnkey-compatible primary and secondary client ID
shapes. Google uses a browser client ID, while Apple's browser Services ID and
native iOS bundle ID remain separate:

```tsx
<ZeroXKeyProvider
  config={{
    organizationId: "your-organization-id",
    auth: {
      oauth: {
        appScheme: "myapp",
        google: {
          primaryClientId: { webClientId: "google-web-client-id" },
          secondaryClientIds: ["another-google-client-id"],
        },
        apple: {
          primaryClientId: {
            serviceId: "apple-services-id",
            iosBundleId: "com.example.myapp",
          },
          secondaryClientIds: ["another-apple-client-id"],
        },
      },
    },
  }}
>
  {/* Your app content */}
</ZeroXKeyProvider>
```

The existing `clientId` provider and handler field remains available as a
deprecated alias for the browser client ID. A per-handler canonical
`primaryClientId` takes priority over that alias and provider configuration.

These fields only configure the current browser OAuth handlers. Native Apple
sign-in and registration or linking of `secondaryClientIds` are not implemented
by this configuration layer and must not be treated as enabled capabilities.
The per-handler `onOauthSuccess` field is also retained for source compatibility
but is not currently forwarded by the browser handlers.

The candidate default hosted HTTPS callback and the customer App scheme are
separate routes. With `appScheme: "example"` and no configured `redirectUri`,
the browser handlers generate the provider callback
`https://oauth-redirect.0xkey.io/?scheme=example` and return to the app through
`example://`. Provider registration must match the generated callback bytes
exactly, including the trailing slash and query. This hosted default is a
release candidate, not a claim of current availability: DNS, TLS, health, and
exact provider-callback acceptance remain release gates.

Pending browser OAuth flows for enabled, fully configured providers are kept in
secure storage and can resume from the app's initial deep link or a later
Linking event after the matching client has finished initialization. Recovery
is deliberately exact: the organization, effective endpoints, client ID,
redirect route, and selected global completion path must still match. A flow
started with a per-call client ID that is not reproduced by current provider
configuration must be restarted; its stored key and transaction are not
silently redirected to configured defaults. Likewise, the per-handler
`onOauthSuccess` closure is not activated during either warm completion or
recovery—use the Provider's existing global redirect callback when the result
must be delivered outside the internal completion path.

Once a callback has been consumed and handed to the selected completion path,
the temporary key is retained conservatively even if later callback, session,
or MFA work rejects or remains pending. Updating Provider configuration does
not switch an already initialized core client to new organization or endpoint
settings; remount with a matching initialized client before starting or
recovering OAuth under those settings.

## Development

This package is part of the ZeroXKey SDK monorepo. To build:

```bash
pnpm build
```

To run tests:

```bash
pnpm test
```

## License

MIT
