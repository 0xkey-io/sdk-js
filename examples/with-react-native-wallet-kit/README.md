# ZeroXKey React Native Wallet Kit Demo

A comprehensive demonstration app showcasing the capabilities of [ZeroXKey's React Native Wallet Kit](https://www.0xkey.com/) for building embedded wallets in React Native applications.

## 🎯 Overview

This demo app illustrates how to integrate ZeroXKey's embedded wallet kit into a React Native application using Expo. It demonstrates secure wallet creation, management, and cryptographic operations without requiring users to manage private keys directly.

## ✨ Features

### Authentication & Session Management

- User authentication with ZeroXKey
  - Email OTP
  - Passkey
  - OAuth (Discord, Facebook, Google, X, Apple)
- Session persistence and expiry tracking
- Secure logout functionality

### Wallet Operations

- **Create Wallets**: Generate new HD wallets with multiple blockchain support
- **Manage Accounts**: Create additional accounts for existing wallets

### Cryptographic Operations

- **Message Signing**: Sign messages with wallet accounts
- **Export Wallets**: Securely export encrypted wallet bundles
- **Export Accounts**: Export individual account private keys with encryption

## 📋 Prerequisites

- **Node.js** 18 or higher, **pnpm** 10.6.3 (SDK monorepo), **npm** 9 or higher (this app)
- **iOS:** Xcode and an Apple Developer team that can sign the bundle ID
- **Android:** Android Studio and a device with Google Play services
- A development build. Expo Go cannot load the native modules this app needs
  (`react-native-passkey`, `react-native-inappbrowser-reborn`, `react-native-keychain`,
  `react-native-device-info`).

## 🚀 Installation & Setup

This app runs against the SDK packages in this repository, not a published npm
version. `metro.config.js` resolves every `@0xkey-io/*` import to
`packages/*/dist` and forces SDK packages to use the app's copy of React,
React Native, and native modules.

### 1. Build the local SDK packages

From the repository root:

```bash
pnpm install --filter . --filter "@0xkey-io/react-native-wallet-kit..." \
  --filter @0xkey-io/internal-codec --filter @0xkey-io/internal-crypto-core
pnpm run build-internal
pnpm --filter "@0xkey-io/react-native-wallet-kit..." run build
```

Rebuild after changing SDK source; Metro picks up the new `dist` output.

### 2. Install the app

```bash
cd examples/with-react-native-wallet-kit
npm install
npm test        # config, native identity, resolver and native dependency checks
npm run typecheck
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

`.env.example` targets 0xkey staging. Fill in the organization ID, Auth Proxy
config ID, RP ID and your native identity. All `EXPO_PUBLIC_*` values are bundled
into the app, so never add API keys or other secrets.

| Variable                                             | Purpose                                                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_ZEROXKEY_ORGANIZATION_ID`               | Parent organization                                                                                                    |
| `EXPO_PUBLIC_ZEROXKEY_API_BASE_URL`                  | API base URL (`https://`)                                                                                              |
| `EXPO_PUBLIC_ZEROXKEY_AUTH_PROXY_URL`                | Auth Proxy URL. Required together with the config ID; otherwise the SDK would send the config ID to the default proxy. |
| `EXPO_PUBLIC_ZEROXKEY_AUTH_PROXY_CONFIG_ID`          | Auth Proxy config with email OTP and passkey sign-up enabled                                                           |
| `EXPO_PUBLIC_ZEROXKEY_RPID`                          | Passkey RP ID, a bare host name. Also becomes the iOS `webcredentials:` associated domain.                             |
| `EXPO_PUBLIC_APP_SCHEME`                             | Deep link scheme used to return from OAuth                                                                             |
| `EXPO_PUBLIC_OAUTH_REDIRECT_URI`                     | Optional OAuth relay override (default `https://oauth-redirect.0xkey.io/`)                                             |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID`                       | Google **web** client ID. Leave empty to hide Google.                                                                  |
| `EXPO_PUBLIC_APPLE_SERVICE_ID`, `..._BUNDLE_ID`      | Apple Services ID and bundle ID                                                                                        |
| `ZEROXKEY_DEMO_APPLE_TEAM_ID`                        | Build time only: your Apple team ID                                                                                    |
| `ZEROXKEY_DEMO_IOS_BUNDLE_ID`, `..._ANDROID_PACKAGE` | Build time only: override `io.zeroxkey.passkeyapp`                                                                     |

The app throws at startup with the names (never the values) of any missing or
malformed variables.

### Polyfills

This example applies `react-native-get-random-values` in `index.js` to support Web Crypto usage across dependencies. Keep this import at the app entrypoint.

## Passkey Setup

Native passkeys only work when the RP ID domain vouches for the app:

- **iOS:** `https://<RP ID>/.well-known/apple-app-site-association` must be served
  directly (no redirect) with `application/json` and list
  `<TEAM_ID>.<bundle ID>` under `webcredentials.apps`. `app.config.js` adds
  `webcredentials:<RP ID>` to the app's associated domains.
- **Android:** `https://<RP ID>/.well-known/assetlinks.json` must grant
  `delegate_permission/common.handle_all_urls` and
  `delegate_permission/common.get_login_creds` to the package name and the SHA-256
  fingerprint of the signing certificate you install with.

Passkeys created on the web under the same RP ID can be used from the app once
both files are in place.

## OAuth Setup

The React Native wallet kit opens the provider in an in-app browser. Google
redirects to the 0xkey OAuth relay, which hands the ID token back to the app
through `EXPO_PUBLIC_APP_SCHEME`.

### Google

1. In Google Cloud Console, create an OAuth client of type **Web application**.
2. Add the authorized redirect URI, exactly, including the `/` before `?`:

   ```
   https://oauth-redirect.0xkey.io/?scheme=withreactnativewalletkit
   ```

   If you set `EXPO_PUBLIC_OAUTH_REDIRECT_URI`, register that URL with the same
   `?scheme=` suffix instead.

3. Allow that web client ID as an OAuth audience in the Auth Proxy config.
4. Set `EXPO_PUBLIC_GOOGLE_CLIENT_ID` to the web client ID.

If you change the scheme, update `EXPO_PUBLIC_APP_SCHEME` and the registered
redirect URI together.

## 📱 Running the App

### On a device

```bash
npm run prebuild                 # regenerates ios/ and android/ from app.config.js
npx expo run:ios --device        # pick the connected iPhone
npx expo run:android --device    # pick the connected Android phone
```

Simulators and emulators can run the OTP flow, but passkey and OAuth results
only count when measured on a physical device.

### Staging device checklist

1. Email OTP sign-up with a new test address, sign out, then log in with OTP again.
2. Sign up with a passkey, sign out, then log in with the same passkey.
3. Google: sign in, cancel once, and return from the background mid-flow.
4. Record the device, OS version, SDK commit and outcome for each step.

### Production Build

```bash
# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android
```

## 📁 Project Structure

```
with-react-native-wallet-kit/
├── app/
│   ├── (main)/
│   │   ├── _layout.tsx      # Main layout with tab navigation
│   │   └── index.tsx         # Home screen with wallet functionality
│   ├── _layout.tsx           # Root layout with ZeroXKey provider
│   └── index.tsx             # Authentication screen
├── components/               # Reusable UI components
├── constants/               # App configuration
│   ├── 0xkey.ts             # Reads EXPO_PUBLIC_* values
│   └── config.ts            # Validates them into the provider config
├── tests/                   # node:test checks (npm test)
├── app.config.js            # Applies native identity and passkey domain
├── metro.config.js          # Resolves @0xkey-io/* to the local SDK build
├── package.json             # Dependencies and scripts
└── README.md               # This file
```

### Key Files

- **`app/(main)/index.tsx`**: Main wallet management interface
- **`app/index.tsx`**: Authentication entry point
- **`app/_layout.tsx`**: ZeroXKey provider setup
- **`constants/0xkey.ts`**: API configuration

## 🔧 Troubleshooting

### Common Issues

1. **Build Errors**
   ```bash
   # Clear cache and reinstall
   npm run clean
   npm install
   npx expo start -c
   ```

## 📄 License

This project is part of the ZeroXKey SDK and is licensed under the Apache License 2.0. See the [LICENSE](../../LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests to help improve this demo.

---

Built with ❤️ by [ZeroXKey](https://www.0xkey.com)
