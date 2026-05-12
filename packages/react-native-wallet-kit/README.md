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
