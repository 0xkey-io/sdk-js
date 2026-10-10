# Captcha RN/Expo development-build candidate

This is an OTP-only staging candidate for Captcha C5d. It mounts the 0xkey-controlled HTTPS challenge root in a patched `react-native-webview`, validates native frame provenance and the bound result, then passes the opaque token once to `ZeroXKeyClient.initOtp({ captchaToken })`. It is not a published SDK sample or a C7 device acceptance result.

## Requirements

- Expo SDK **56.0.22**, React Native **0.85.3**, `react-native-webview` **13.16.1**, `expo-dev-client` **56.0.27**. The exact versions and upstream WebView tarball integrity are in `package-lock.json`.
- A custom Expo **development build**. Expo Go cannot load the native WebView patch.
- The C1-controlled `https://captcha.staging.0xkey.io/` challenge page, with a valid certificate and the staging widget hostname registered. The page is still a deployment dependency.
- C3 `POST /v1/wallet_kit_client_params` on the selected Auth Proxy URL and Config ID. The app reads the current public site key before each attempt. Trusted off renders no challenge; 503 or malformed params stops the attempt. Never add a Turnstile secret, API credential, OTP, or challenge token to `.env`.
- A test organization, Config ID, auth proxy URL, and email authorized for staging OTP.

## Local build

From the SDK repository root, install and build its local Core package closure using the repository's usual `pnpm install` and `pnpm run build-all`. Then:

```sh
cd examples/authentication/captcha-rn-expo
npm ci
cp .env.example .env
# Fill the public test values in .env; do not add secrets.
npm run typecheck
npm run verify:patch
npm run ios       # or npm run android; installs a development build
```

`npm ci` runs `patch-package` and the SHA-256 verifier. The checked-in patch modifies only WebView 13.16.1's Android `WebMessageListener` and `WebResourceRequest` callbacks, iOS `WKScriptMessage` callback, and event declarations. Android's legacy `addJavascriptInterface` fallback deliberately emits **no** `captchaSourceKind` and cannot complete a challenge. The legacy String navigation callback leaves `isTopFrame` unknown; only `WebResourceRequest.isForMainFrame()` supplies that field to both Android JS dispatch paths. The verifier rejects an absent or changed patch and checks the pinned WebViewShared navigation routing. `npm run start` launches Metro for an installed development build.

The app imports the local Core `dist` output and the local bridge source. Its Metro resolver replaces **only** the unused WalletConnect SignClient in this OTP-only sample with a module whose `init()` throws. No `walletConfig` is supplied, and this sample does not demonstrate WalletConnect or a packed/public RN package. Remove this sample-only resolver before using another wallet path; it must never be copied into a general SDK app.

## Flow and security boundary

Each attempt generates a fresh transaction ID and 32-byte cryptographic nonce. The WebView loads only the exact controlled root; the app injects `init.v1` into that page after load. It never puts the site key, transaction, nonce, or token in a URL. The page renders Turnstile, then its native message reaches the SDK adapter. The bridge checks the same WebView owner, independent top-level URL, main-frame flag, platform frame origin/URL, transaction, Config ID, nonce, expiry and one-time consumption. A normal `onMessage`, Android fallback, same-origin iframe, changed navigation, wrong binding, or replay cannot complete the attempt. App backgrounding, unmount, and new attempts cancel the old bridge. The app keeps the token only in the `initOtp` call argument; it does not store or log it.

`originWhitelist={["*"]}` is a routing setting in this **pinned sample**, not its security policy. In WebView 13.16.1, a URL outside that list is sent to React Native `Linking.openURL` before the app callback. The wildcard makes every navigation reach `onShouldStartLoadWithRequest`; the app then permits only the exact controlled root or a Cloudflare **subframe** with `isTopFrame === false`. Unknown top-level URLs, missing frame flags, query/hash changes, and other origins are rejected. The routing verifier pins WebViewShared source and checks this callback connection. Android WebView versions or paths that cannot report the navigation distinction may block the widget. WebView's JS-debug fallback can reload an allowed subframe URL as a top-level URL; C7 device testing must verify this behavior as well as JS/DOM storage, user agent, TLS, Cloudflare network access, token callback and server Siteverify on iOS and Android.

## Current evidence and gates

The isolated sample also contains an unconnected Swift/Kotlin native bound
context source candidate. It is not used by this OTP flow or default Core/RN
storage. See [the native capability gate](native-bound-context-capability.md)
for the source-level checks and the still-open host authorization, protected
storage, key-use, build, and device requirements.

Local checks: `npm ci` applied and verified the exact native patch; `npm run typecheck` passed; Android and iOS Metro export can be run without a device. The SDK adapter's negative tests cover stock events, fallback, subframes, navigation, malformed event access, one-shot acceptance, and valid iOS/Android messages. The app now consumes the public C3 client params API for each attempt. These checks do not prove native compilation, native event delivery, effective C3/C1 resource selection, the deployed challenge host, or a successful staging OTP. The protected server route, native development builds, and both real-device paths must be checked against the final staging candidate before C5d or C7 is accepted.
