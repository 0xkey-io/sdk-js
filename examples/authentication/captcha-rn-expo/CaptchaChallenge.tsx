import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import WebView, {
  type WebViewMessageEvent,
  type WebViewNavigation,
  type WebViewProps,
} from "react-native-webview";
import { receiveCaptchaNativeMessage } from "../../../packages/react-native-wallet-kit/src/utils/captcha-webview-adapter";
import { createCaptchaWebViewBridge } from "../../../packages/react-native-wallet-kit/src/utils/captcha-webview-bridge";
import { permitsCaptchaNavigation } from "../../../packages/react-native-wallet-kit/src/utils/captcha-webview-navigation";

type Props = {
  origin: "https://captcha.staging.0xkey.io" | "https://captcha.0xkey.io";
  configId: string;
  siteKey: string;
  transactionId: string;
  onToken(token: string): Promise<void>;
  onFailure(): void;
};

function freshNonce(): string {
  return Array.from(Crypto.getRandomBytes(32), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export default function CaptchaChallenge({
  origin,
  configId,
  siteKey,
  transactionId,
  onToken,
  onFailure,
}: Props) {
  const webView = useRef<WebView>(null);
  const started = useRef(false);
  const terminal = useRef(false);
  const [phase, setPhase] = useState<"loading" | "waiting" | "done" | "failed">(
    "loading",
  );
  const bridge = useMemo(
    () =>
      createCaptchaWebViewBridge({
        origin,
        configId,
        siteKey,
        transactionId,
        nonce: freshNonce(),
        expiresAt: Date.now() + 120_000,
        webView,
        now: Date.now,
      }),
    [origin, configId, siteKey, transactionId],
  );
  const rootUrl = `${origin}/`;
  const fail = useCallback(() => {
    if (terminal.current) return;
    terminal.current = true;
    bridge.cancel();
    setPhase("failed");
    onFailure();
  }, [bridge, onFailure]);

  useEffect(() => {
    const timeout = setTimeout(
      fail,
      Math.max(0, (bridge.init.expiresAt as number) - Date.now()),
    );
    const background = AppState.addEventListener("change", (state) => {
      if (state !== "active") fail();
    });
    return () => {
      clearTimeout(timeout);
      background.remove();
      bridge.cancel();
    };
  }, [bridge, fail]);

  // WebViewShared opens URLs outside originWhitelist with Linking before
  // calling this guard. The '*' prop routes every URL here first.
  const allowNavigation = (
    request: Parameters<
      NonNullable<WebViewProps["onShouldStartLoadWithRequest"]>
    >[0],
  ): boolean => {
    // Only the patched native request callback can supply isTopFrame=false.
    // The older String overload leaves it unknown and fails closed here.
    if (permitsCaptchaNavigation(origin, request)) return true;
    fail();
    return false;
  };

  const onNavigation = (navigation: WebViewNavigation) => {
    if (started.current && navigation.url !== rootUrl) fail();
  };

  const onLoaded = (event: { nativeEvent: { url: string } }) => {
    if (terminal.current) return;
    if (phase !== "loading" || event.nativeEvent.url !== rootUrl) {
      fail();
      return;
    }
    started.current = true;
    const script = `window.__ZEROXKEY_CAPTCHA_START__(${JSON.stringify(bridge.init)}); true;`;
    webView.current?.injectJavaScript(script);
    setPhase("waiting");
  };

  const onMessage = (event: WebViewMessageEvent) => {
    // This handler belongs to this WebView ref; page data cannot choose it.
    const outcome = receiveCaptchaNativeMessage(bridge, webView, event);
    if (outcome.kind === "accepted") {
      terminal.current = true;
      setPhase("done");
      void onToken(outcome.token).catch(() => {
        setPhase("failed");
        onFailure();
      });
    } else if (outcome.kind === "error") {
      fail();
    }
  };

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header">Captcha challenge</Text>
      {phase === "failed" ? (
        <Text>Challenge stopped. Start a new attempt.</Text>
      ) : phase === "done" ? (
        <Text>Submitting protected request…</Text>
      ) : (
        <WebView
          ref={webView}
          source={{ uri: rootUrl }}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="never"
          cacheEnabled={false}
          setSupportMultipleWindows={false}
          applicationNameForUserAgent="0xkey-captcha-rn-expo/0.0.0"
          onShouldStartLoadWithRequest={allowNavigation}
          onNavigationStateChange={onNavigation}
          onLoadEnd={onLoaded}
          onMessage={onMessage}
          onError={fail}
          onHttpError={fail}
          style={styles.webView}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webView: { flex: 1 },
});
