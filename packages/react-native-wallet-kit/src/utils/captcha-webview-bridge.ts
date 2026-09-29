export type CaptchaBridgeContext = Readonly<{
  origin: string;
  transactionId: string;
  configId: string;
  nonce: string;
  siteKey: string;
  expiresAt: number;
  webView: object;
  now(): number;
}>;

// Only a native adapter that preserves the platform's frame provenance may
// construct this input. Stock react-native-webview onMessage drops isMainFrame.
export type CaptchaBridgeInput = Readonly<{
  webView: object;
  topLevelUrl: string;
  isMainFrame: boolean;
  data: string;
}> &
  (
    | Readonly<{
        sourceKind: "android-web-message-listener";
        sourceOrigin: string;
      }>
    | Readonly<{
        sourceKind: "ios-wk-script-message";
        sourceFrameUrl: string;
      }>
  );

export type CaptchaBridgeResult =
  | Readonly<{ kind: "accepted"; token: string }>
  | Readonly<{
      kind: "error";
      code: "expired" | "invalid-token" | "widget-error" | "timeout";
    }>
  | Readonly<{
      kind: "rejected";
      reason:
        | "closed"
        | "source"
        | "provenance"
        | "expired"
        | "clock"
        | "message"
        | "binding";
    }>;

const CONTROLLED_ORIGINS = new Set([
  "https://captcha.staging.0xkey.io",
  "https://captcha.0xkey.io",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VISIBLE_ASCII = /^[\x21-\x7e]+$/;
const ERROR_CODES = new Set([
  "expired",
  "invalid-token",
  "widget-error",
  "timeout",
]);
const RESULT_KEYS = [
  "type",
  "origin",
  "transactionId",
  "configId",
  "nonce",
  "expiresAt",
  "token",
];
const ERROR_KEYS = [
  "type",
  "origin",
  "transactionId",
  "configId",
  "nonce",
  "code",
];

function visible(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= min &&
    value.length <= max &&
    VISIBLE_ASCII.test(value)
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

export function createCaptchaWebViewBridge(context: CaptchaBridgeContext): {
  readonly init: Readonly<Record<string, unknown>>;
  receive(input: CaptchaBridgeInput): CaptchaBridgeResult;
  cancel(): void;
} {
  let snapshot: CaptchaBridgeContext;
  let initialNow: number;
  try {
    snapshot = {
      origin: context.origin,
      transactionId: context.transactionId,
      configId: context.configId,
      nonce: context.nonce,
      siteKey: context.siteKey,
      expiresAt: context.expiresAt,
      webView: context.webView,
      now: context.now,
    };
    initialNow = snapshot.now();
  } catch {
    throw new Error("Invalid Captcha bridge context");
  }
  if (
    !CONTROLLED_ORIGINS.has(snapshot.origin) ||
    !visible(snapshot.transactionId, 1, 128) ||
    !UUID.test(snapshot.configId) ||
    !visible(snapshot.nonce, 24, 128) ||
    !visible(snapshot.siteKey, 1, 128) ||
    !Number.isSafeInteger(initialNow) ||
    !Number.isSafeInteger(snapshot.expiresAt) ||
    snapshot.expiresAt <= initialNow ||
    snapshot.expiresAt > initialNow + 120_000 ||
    snapshot.webView === null ||
    typeof snapshot.webView !== "object"
  ) {
    throw new Error("Invalid Captcha bridge context");
  }

  const init = Object.freeze({
    type: "0xkey.captcha.init.v1",
    origin: snapshot.origin,
    transactionId: snapshot.transactionId,
    configId: snapshot.configId,
    nonce: snapshot.nonce,
    siteKey: snapshot.siteKey,
    expiresAt: snapshot.expiresAt,
  });
  const expectedWebView = snapshot.webView;
  const now = snapshot.now;
  let closed = false;

  return {
    init,
    cancel() {
      closed = true;
    },
    receive(input) {
      if (closed) return { kind: "rejected", reason: "closed" };
      let actualWebView: unknown;
      try {
        actualWebView = input.webView;
      } catch {
        return { kind: "rejected", reason: "provenance" };
      }
      if (actualWebView !== expectedWebView) {
        return { kind: "rejected", reason: "source" };
      }
      let sourceKind: unknown;
      let source: unknown;
      let isMainFrame: unknown;
      let topLevelUrl: unknown;
      let data: unknown;
      try {
        const nativeInput = input as unknown as Record<string, unknown>;
        sourceKind = input.sourceKind;
        isMainFrame = input.isMainFrame;
        topLevelUrl = input.topLevelUrl;
        if (sourceKind === "android-web-message-listener") {
          source = nativeInput.sourceOrigin;
        } else if (sourceKind === "ios-wk-script-message") {
          source = nativeInput.sourceFrameUrl;
        }
        data = input.data;
      } catch {
        return { kind: "rejected", reason: "provenance" };
      }
      if (
        isMainFrame !== true ||
        topLevelUrl !== `${init.origin}/` ||
        (sourceKind === "android-web-message-listener" &&
          source !== init.origin) ||
        (sourceKind === "ios-wk-script-message" &&
          source !== `${init.origin}/`) ||
        (sourceKind !== "android-web-message-listener" &&
          sourceKind !== "ios-wk-script-message")
      ) {
        return { kind: "rejected", reason: "provenance" };
      }
      let currentTime: number;
      try {
        currentTime = now();
      } catch {
        closed = true;
        return { kind: "rejected", reason: "clock" };
      }
      if (!Number.isSafeInteger(currentTime)) {
        closed = true;
        return { kind: "rejected", reason: "clock" };
      }
      if (currentTime >= init.expiresAt) {
        closed = true;
        return { kind: "rejected", reason: "expired" };
      }
      if (typeof data !== "string" || data.length > 8192) {
        return { kind: "rejected", reason: "message" };
      }

      let message: unknown;
      try {
        message = JSON.parse(data);
      } catch {
        return { kind: "rejected", reason: "message" };
      }
      if (!record(message)) return { kind: "rejected", reason: "message" };
      const isResult = message.type === "0xkey.captcha.result.v1";
      const isError = message.type === "0xkey.captcha.error.v1";
      if (
        (!isResult && !isError) ||
        !exactKeys(message, isResult ? RESULT_KEYS : ERROR_KEYS)
      ) {
        return { kind: "rejected", reason: "message" };
      }
      if (
        message.origin !== init.origin ||
        message.transactionId !== init.transactionId ||
        message.configId !== init.configId ||
        message.nonce !== init.nonce ||
        (isResult && message.expiresAt !== init.expiresAt)
      ) {
        return { kind: "rejected", reason: "binding" };
      }
      if (isError) {
        if (
          typeof message.code !== "string" ||
          !ERROR_CODES.has(message.code)
        ) {
          return { kind: "rejected", reason: "message" };
        }
        closed = true;
        return {
          kind: "error",
          code: message.code as
            | "expired"
            | "invalid-token"
            | "widget-error"
            | "timeout",
        };
      }
      if (!visible(message.token, 1, 2048)) {
        return { kind: "rejected", reason: "message" };
      }
      closed = true;
      return { kind: "accepted", token: message.token };
    },
  };
}
