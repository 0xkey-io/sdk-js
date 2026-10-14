import { useCallback, useEffect, useMemo, useRef } from "react";
import { AppState, StyleSheet } from "react-native";
import WebView, {
  type WebViewMessageEvent,
  type WebViewNavigation,
  type WebViewProps,
} from "react-native-webview";
import {
  createCaptchaWebViewBridge,
  permitsCaptchaNavigation,
  receiveCaptchaNativeMessage,
} from "@0xkey-io/react-native-wallet-kit";

import type { CaptchaOrigin } from "@/constants/captcha";

const CHALLENGE_LIFETIME_MS = 120_000;

type Props = {
  origin: CaptchaOrigin;
  configId: string;
  siteKey: string;
  transactionId: string;
  nonce: string;
  onToken(token: string): void;
  onStop(): void;
};

/**
 * One challenge on the controlled page. Completion needs the patched
 * react-native-webview (see patches/): only its native frame provenance lets
 * the bridge accept a result, and a stock build fails closed.
 */
export function CaptchaChallenge({
  origin,
  configId,
  siteKey,
  transactionId,
  nonce,
  onToken,
  onStop,
}: Props) {
  const webView = useRef<WebView>(null);
  const started = useRef(false);
  const terminal = useRef(false);
  const bridge = useMemo(() => {
    try {
      return createCaptchaWebViewBridge({
        origin,
        configId,
        siteKey,
        transactionId,
        nonce,
        expiresAt: Date.now() + CHALLENGE_LIFETIME_MS,
        webView,
        now: Date.now,
      });
    } catch {
      return null;
    }
  }, [origin, configId, siteKey, transactionId, nonce]);
  const rootUrl = `${origin}/`;

  const stop = useCallback(() => {
    if (terminal.current) return;
    terminal.current = true;
    bridge?.cancel();
    onStop();
  }, [bridge, onStop]);

  useEffect(() => {
    if (!bridge) {
      stop();
      return;
    }
    const timeout = setTimeout(
      stop,
      Math.max(0, (bridge.init.expiresAt as number) - Date.now()),
    );
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "background") stop();
    });
    return () => {
      clearTimeout(timeout);
      appState.remove();
      bridge.cancel();
    };
  }, [bridge, stop]);

  // WebViewShared opens URLs outside originWhitelist with Linking before it
  // calls this guard, so the '*' whitelist routes every URL here first.
  const allowNavigation: WebViewProps["onShouldStartLoadWithRequest"] = (
    request,
  ) => {
    if (permitsCaptchaNavigation(origin, request)) return true;
    stop();
    return false;
  };

  const onNavigation = (navigation: WebViewNavigation) => {
    if (started.current && navigation.url !== rootUrl) stop();
  };

  if (!bridge) return null;

  const onLoadEnd = (event: { nativeEvent: { url: string } }) => {
    if (terminal.current) return;
    if (started.current || event.nativeEvent.url !== rootUrl) {
      stop();
      return;
    }
    started.current = true;
    webView.current?.injectJavaScript(
      `window.__ZEROXKEY_CAPTCHA_START__(${JSON.stringify(bridge.init)}); true;`,
    );
  };

  const onMessage = (event: WebViewMessageEvent) => {
    if (terminal.current) return;
    const outcome = receiveCaptchaNativeMessage(bridge, webView, event);
    if (outcome.kind === "accepted") {
      terminal.current = true;
      onToken(outcome.token);
    } else if (outcome.kind === "error") {
      stop();
    }
  };

  return (
    <WebView
      ref={webView}
      source={{ uri: rootUrl }}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled
      mixedContentMode="never"
      cacheEnabled={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={allowNavigation}
      onNavigationStateChange={onNavigation}
      onLoadEnd={onLoadEnd}
      onMessage={onMessage}
      onError={stop}
      onHttpError={stop}
      style={styles.webView}
    />
  );
}

const styles = StyleSheet.create({
  webView: { flex: 1 },
});
