import type {
  CaptchaBridgeInput,
  CaptchaBridgeResult,
} from "./captcha-webview-bridge";

/** Extra properties emitted by the pinned react-native-webview native patch. */
export type CaptchaNativeMessageEvent = Readonly<{
  nativeEvent: Readonly<{
    data: string;
    captchaSourceKind?: string;
    captchaSourceOrigin?: string;
    captchaSourceFrameUrl?: string;
    captchaIsMainFrame?: boolean;
    captchaTopLevelUrl?: string;
  }>;
}>;

/**
 * Forward only native callback metadata. Stock onMessage and the Android
 * JavaScript-interface fallback have no frame proof and fail closed.
 */
export function receiveCaptchaNativeMessage(
  bridge: { receive(input: CaptchaBridgeInput): CaptchaBridgeResult },
  webView: object,
  event: unknown,
): CaptchaBridgeResult {
  try {
    const nativeEvent = (event as CaptchaNativeMessageEvent).nativeEvent;
    if (nativeEvent.captchaSourceKind === "android-web-message-listener") {
      return bridge.receive({
        webView,
        sourceKind: "android-web-message-listener",
        sourceOrigin: nativeEvent.captchaSourceOrigin as string,
        isMainFrame: nativeEvent.captchaIsMainFrame as boolean,
        topLevelUrl: nativeEvent.captchaTopLevelUrl as string,
        data: nativeEvent.data,
      });
    }
    if (nativeEvent.captchaSourceKind === "ios-wk-script-message") {
      return bridge.receive({
        webView,
        sourceKind: "ios-wk-script-message",
        sourceFrameUrl: nativeEvent.captchaSourceFrameUrl as string,
        isMainFrame: nativeEvent.captchaIsMainFrame as boolean,
        topLevelUrl: nativeEvent.captchaTopLevelUrl as string,
        data: nativeEvent.data,
      });
    }
  } catch {
    // A malformed synthetic event is untrusted and must not complete a flow.
  }
  return { kind: "rejected", reason: "provenance" };
}
