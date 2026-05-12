# @0xkey-io/react-wallet-kit

The `@0xkey-io/react-wallet-kit` is a powerful SDK that allows you to integrate ZeroXKey's Embedded Wallets into your React applications. It provides a set of UI components and easy-to-use functions, all exported from a hook, enabling you to quickly build secure embedded wallet experiences.

## Getting started

To learn how to setup your ZeroXKey organization and configure the Auth Proxy, check out our [Getting Started](https://docs.0xkey.com/sdks/react/getting-started) guide!

## Installation

You can use `@0xkey-io/react-wallet-kit` in any React based web application.

For this guide, let's create a new `Next.js` app. If you already have an existing app, you don't need to do this.

```bash npx
npx create-next-app@latest
```

Now, install the ZeroXKey React Wallet Kit package:

<CodeGroup>

```bash npm
npm install @0xkey-io/react-wallet-kit
```

```bash pnpm
pnpm add @0xkey-io/react-wallet-kit
```

```bash yarn
yarn add @0xkey-io/react-wallet-kit
```

</CodeGroup>

## Provider

Wrap your app with the `ZeroXKeyProvider` component, and import `"@0xkey-io/react-wallet-kit/styles.css"` to include styles for the UI components.

With Next.js App Router, keep `app/layout.tsx` as a server component and create a separate `app/providers.tsx` client wrapper. This is necessary if you want to pass callbacks (e.g., onError), which must be defined in a client component.

```tsx app/providers.tsx
"use client";

import {
  ZeroXKeyProvider,
  ZeroXKeyProviderConfig,
} from "@0xkey-io/react-wallet-kit";

const zeroXKeyConfig: ZeroXKeyProviderConfig = {
  organizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
  authProxyConfigId: process.env.NEXT_PUBLIC_AUTH_PROXY_CONFIG_ID!,
};

export function Providers({ children }: { children: React.ReactNode }) {
  return <ZeroXKeyProvider config={zeroXKeyConfig}>{children}</ZeroXKeyProvider>;
}
```

In case anything goes wrong, let's add an `onError` callback to the `ZeroXKeyProvider` to catch any errors that may occur.

```tsx app/providers.tsx
<ZeroXKeyProvider
  config={zeroXKeyConfig}
  callbacks={{
    onError: (error) => console.error("ZeroXKey error:", error),
  }}
>
```

Then, use the `Providers` component to wrap your app in `app/layout.tsx`.

```tsx app/layout.tsx
import "@0xkey-io/react-wallet-kit/styles.css";
import "./globals.css";
import Providers from "./providers";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

> **Why this pattern?**
>
> - Callbacks (and other interactive bits) must be declared in a client component.
> - Keeping layout.tsx as a server component maintains optimal rendering and avoids making your entire app client-side unnecessarily.
> - Centralizing ZeroXKey setup in app/providers.tsx keeps configuration, styles, and callbacks in one place.


## Quick authentication

The easiest way to handle authentication is using the `handleLogin` function from the `useZeroXKey` hook. This will automatically show a modal with all the authentication methods you've enabled in your dashboard.

```tsx
import { useZeroXKey } from "@0xkey-io/react-wallet-kit";

function LoginButton() {
  const { handleLogin } = useZeroXKey();

  return <button onClick={handleLogin}>Login / Sign Up</button>;
}
```


For more information, check out [our docs!](https://docs.0xkey.com/sdks/react)