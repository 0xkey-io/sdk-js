---
"@0xkey-io/react-native-wallet-kit": patch
---

Export `permitsCaptchaNavigation`, the navigation guard for the Captcha
challenge WebView. Apps that render the controlled challenge page pass it to
`onShouldStartLoadWithRequest`: it allows only the exact challenge page and
Cloudflare subframes, and rejects every other navigation.
