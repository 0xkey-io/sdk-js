# Captcha WebView native adapter contract

Status: **local implementation candidate; not a public RN API or a completed Expo flow.** `src/utils/captcha-webview-bridge.ts` validates a message only after a trusted native adapter supplies frame provenance. Its input fields must not be populated from the message body, page JavaScript, a cached navigation event, or stock `react-native-webview` `onMessage` alone.

## Why stock `onMessage` is insufficient

The SDK currently has no `react-native-webview` dependency or pinned version. Expo's current WebView documentation recommends 13.16.1. In that version, the public [`WebViewMessage` type](https://github.com/react-native-webview/react-native-webview/blob/v13.16.1/src/WebViewTypes.ts) has `data` and a single `url`, with no message-frame flag. Android's [`WebMessageListener`](https://github.com/react-native-webview/react-native-webview/blob/v13.16.1/android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java) receives `sourceOrigin` and `isMainFrame`, but the package forwards only the origin. Its `addJavascriptInterface` fallback forwards the WebView's top-level URL, which cannot identify the sending frame. iOS receives [`WKScriptMessage.frameInfo.request.URL`](https://github.com/react-native-webview/react-native-webview/blob/v13.16.1/apple/RNCWebViewImpl.m) and forwards it as `url`, but does not forward `frameInfo.isMainFrame`. A same-origin subframe can therefore look like the controlled page. The bridge rejects these ordinary events, including results and errors.

## Required native event

The adapter must emit one event with `data`, an opaque identity for the emitting WebView owner, `isMainFrame === true`, and that same WebView's independently captured `topLevelUrl === https://captcha.staging.0xkey.io/` (or the separately reviewed production root). URL path, query, fragment, port, userinfo, scheme, or host variation is rejected.

- **Android:** use a supported `WebViewCompat.WebMessageListener` callback. Preserve its native `sourceOrigin` and `isMainFrame`, and capture the same WebView's current top-level URL for that callback. Mark `sourceKind: "android-web-message-listener"` only on this path. If `WEB_MESSAGE_LISTENER` is unavailable, fail closed; the JavaScript interface fallback has no frame proof.
- **iOS:** preserve `WKScriptMessage.frameInfo.request.URL` as `sourceFrameUrl`, `frameInfo.isMainFrame`, and the same `WKWebView.URL` as `topLevelUrl` in the callback. Mark `sourceKind: "ios-wk-script-message"` only on this path. Do not infer the frame flag from equal URLs.

The native adapter must keep owner identity, frame metadata, top-level URL, and data associated with the same callback. A navigation between message receipt and URL capture must reject the event. The RN helper then checks exact provenance and the Frames `init/result/error.v1` transaction ID, Config ID, nonce, expiry, message shape, and single consumption. Invalid provenance cannot terminate the pending operation, even when the message claims a widget error.

## Expo integration and acceptance dependencies

The Expo example needs a pinned WebView version and a native adapter that emits this event on both platforms. It also needs a custom **development build**; [Expo Go does not load arbitrary custom native code](https://docs.expo.dev/workflow/customizing/). The App must generate a fresh cryptographically random nonce, use the C3 public site key for the exact Config ID, load only the controlled HTTPS root, block navigation away from it, inject the bounded `init.v1` context after page readiness, cancel on background/unmount/config change, and pass an accepted token only once to the protected Core request. No token may enter URL, OAuth state, storage, or logs. The controlled page, TLS, Cloudflare script, native event provenance, and real iOS/Android operation remain C7 device checks.
