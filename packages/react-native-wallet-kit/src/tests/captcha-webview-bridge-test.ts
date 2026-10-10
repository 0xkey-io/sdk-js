import { describe, expect, it } from "@jest/globals";
import {
  createCaptchaWebViewBridge,
  type CaptchaBridgeInput,
} from "../utils/captcha-webview-bridge";

const origin = "https://captcha.staging.0xkey.io";
const configId = "5cc1732a-b599-43c8-a61e-041d1821d0fd";
const nonce = "0123456789abcdef0123456789abcdef";
const transactionId = "transaction-1";
const token = "opaque-turnstile-token";

function fixture() {
  const webView = {};
  let now = 1_000;
  const bridge = createCaptchaWebViewBridge({
    origin,
    transactionId,
    configId,
    nonce,
    siteKey: "0x4AAAAAAFH-twNe8j1RAA09",
    expiresAt: 121_000,
    webView,
    now: () => now,
  });
  const message = {
    type: "0xkey.captcha.result.v1",
    origin,
    transactionId,
    configId,
    nonce,
    expiresAt: 121_000,
    token,
  };
  return {
    bridge,
    webView,
    message,
    setNow: (value: number) => {
      now = value;
    },
    receive: (value: unknown, overrides: Record<string, unknown> = {}) =>
      bridge.receive({
        webView,
        sourceKind: "android-web-message-listener",
        sourceOrigin: origin,
        isMainFrame: true,
        topLevelUrl: `${origin}/`,
        ...overrides,
        data: JSON.stringify(value),
      } as CaptchaBridgeInput),
  };
}

describe("Captcha WebView bridge", () => {
  it("passes only the bounded public context to the controlled page", () => {
    const { bridge } = fixture();
    expect(bridge.init).toEqual({
      type: "0xkey.captcha.init.v1",
      origin,
      transactionId,
      configId,
      nonce,
      siteKey: "0x4AAAAAAFH-twNe8j1RAA09",
      expiresAt: 121_000,
    });
    expect(JSON.stringify(bridge.init)).not.toContain(token);
  });

  it("accepts one matching result and rejects its replay", () => {
    const { receive, message } = fixture();
    expect(receive(message)).toEqual({ kind: "accepted", token });
    expect(receive(message)).toEqual({ kind: "rejected", reason: "closed" });
  });

  it("rejects another WebView and an unexpected top-level page URL", () => {
    const { receive, message } = fixture();
    expect(receive(message, { webView: {} })).toEqual({
      kind: "rejected",
      reason: "source",
    });
    for (const url of [
      "https://evil.example/",
      `${origin}/other`,
      `${origin}/?token=leak`,
      `${origin}/#fragment`,
      "http://captcha.staging.0xkey.io/",
    ]) {
      expect(receive(message, { topLevelUrl: url })).toEqual({
        kind: "rejected",
        reason: "provenance",
      });
    }
    expect(receive(message)).toEqual({ kind: "accepted", token });
  });

  it("rejects public onMessage, Android origin-only, and fallback callbacks", () => {
    const { bridge, webView, receive, message } = fixture();
    const data = JSON.stringify(message);
    for (const input of [
      { webView, url: `${origin}/`, data },
      {
        webView,
        sourceKind: "android-web-message-listener",
        sourceOrigin: origin,
        data,
      },
      {
        webView,
        sourceKind: "android-fallback",
        topLevelUrl: `${origin}/`,
        data,
      },
    ]) {
      expect(bridge.receive(input as CaptchaBridgeInput)).toEqual({
        kind: "rejected",
        reason: "provenance",
      });
    }
    expect(receive(message)).toEqual({ kind: "accepted", token });
  });

  it("rejects same-origin and cross-origin subframe results and errors without closing", () => {
    const { receive, message } = fixture();
    expect(receive(message, { isMainFrame: false })).toEqual({
      kind: "rejected",
      reason: "provenance",
    });
    expect(
      receive(message, {
        sourceOrigin: "https://evil.example",
        isMainFrame: false,
      }),
    ).toEqual({ kind: "rejected", reason: "provenance" });
    expect(
      receive(
        {
          type: "0xkey.captcha.error.v1",
          origin,
          transactionId,
          configId,
          nonce,
          code: "widget-error",
        },
        { isMainFrame: false },
      ),
    ).toEqual({
      kind: "rejected",
      reason: "provenance",
    });
    expect(receive(message)).toEqual({ kind: "accepted", token });
  });

  it("requires the iOS message frame and independently checked top-level URL", () => {
    const { receive, message } = fixture();
    const ios = {
      sourceKind: "ios-wk-script-message",
      sourceFrameUrl: `${origin}/`,
      sourceOrigin: undefined,
    };
    expect(receive(message, { ...ios, isMainFrame: false })).toEqual({
      kind: "rejected",
      reason: "provenance",
    });
    expect(
      receive(message, {
        ...ios,
        sourceFrameUrl: "https://evil.example/",
      }),
    ).toEqual({ kind: "rejected", reason: "provenance" });
    expect(
      receive(message, {
        ...ios,
        topLevelUrl: `${origin}/#stale`,
      }),
    ).toEqual({ kind: "rejected", reason: "provenance" });
    expect(receive(message, ios)).toEqual({ kind: "accepted", token });
  });

  it("turns a throwing native input getter into a non-terminal rejection", () => {
    const { bridge, webView, receive, message } = fixture();
    const input = {
      webView,
      sourceKind: "android-web-message-listener",
      get sourceOrigin() {
        throw new Error("untrusted getter");
      },
      isMainFrame: true,
      topLevelUrl: `${origin}/`,
      data: JSON.stringify(message),
    };
    expect(bridge.receive(input as unknown as CaptchaBridgeInput)).toEqual({
      kind: "rejected",
      reason: "provenance",
    });
    expect(receive(message)).toEqual({ kind: "accepted", token });
  });

  it.each(["origin", "transactionId", "configId", "nonce", "expiresAt"])(
    "rejects a result with the wrong %s without consuming the operation",
    (field) => {
      const { receive, message } = fixture();
      expect(receive({ ...message, [field]: "wrong" })).toEqual({
        kind: "rejected",
        reason: "binding",
      });
      expect(receive(message)).toEqual({ kind: "accepted", token });
    },
  );

  it("rejects malformed, extended, and oversized messages without revealing them", () => {
    const { bridge, webView, message, receive } = fixture();
    expect(
      bridge.receive({
        webView,
        sourceKind: "android-web-message-listener",
        sourceOrigin: origin,
        isMainFrame: true,
        topLevelUrl: `${origin}/`,
        data: "{",
      } as CaptchaBridgeInput),
    ).toEqual({
      kind: "rejected",
      reason: "message",
    });
    expect(receive({ ...message, extra: "ignored?" })).toEqual({
      kind: "rejected",
      reason: "message",
    });
    expect(receive({ ...message, token: "x".repeat(2049) })).toEqual({
      kind: "rejected",
      reason: "message",
    });
    expect(receive(message)).toEqual({ kind: "accepted", token });
  });

  it("rejects a result at the deadline and after background invalidation", () => {
    const expired = fixture();
    expired.setNow(121_000);
    expect(expired.receive(expired.message)).toEqual({
      kind: "rejected",
      reason: "expired",
    });
    const backgrounded = fixture();
    backgrounded.bridge.cancel();
    expect(backgrounded.receive(backgrounded.message)).toEqual({
      kind: "rejected",
      reason: "closed",
    });
  });

  it("ends a matching widget error without returning a token", () => {
    const { receive, message } = fixture();
    expect(
      receive({
        type: "0xkey.captcha.error.v1",
        origin,
        transactionId,
        configId,
        nonce,
        code: "widget-error",
      }),
    ).toEqual({ kind: "error", code: "widget-error" });
    expect(receive(message)).toEqual({ kind: "rejected", reason: "closed" });
  });

  it("keeps the original binding when the caller mutates its input object", () => {
    const webView = {};
    const context = {
      origin,
      transactionId,
      configId,
      nonce,
      siteKey: "0x4AAAAAAFH-twNe8j1RAA09",
      expiresAt: 121_000,
      webView,
      now: () => 1_000,
    };
    const bridge = createCaptchaWebViewBridge(context);
    context.transactionId = "forged-transaction";
    context.nonce = "abcdef0123456789abcdef0123456789";
    expect(
      bridge.receive({
        webView,
        sourceKind: "android-web-message-listener",
        sourceOrigin: origin,
        isMainFrame: true,
        topLevelUrl: `${origin}/`,
        data: JSON.stringify({
          type: "0xkey.captcha.result.v1",
          origin,
          transactionId: context.transactionId,
          configId,
          nonce: context.nonce,
          expiresAt: 121_000,
          token,
        }),
      } as CaptchaBridgeInput),
    ).toEqual({ kind: "rejected", reason: "binding" });
    expect(bridge.init).toMatchObject({ transactionId, nonce });
  });

  it("validates and publishes the same origin snapshot from a changing context", () => {
    let originReads = 0;
    const context = {
      get origin() {
        originReads += 1;
        return originReads === 1 ? origin : "https://evil.example";
      },
      transactionId,
      configId,
      nonce,
      siteKey: "0x4AAAAAAFH-twNe8j1RAA09",
      expiresAt: 121_000,
      webView: {},
      now: () => 1_000,
    };
    const bridge = createCaptchaWebViewBridge(context);
    expect(bridge.init).toMatchObject({ origin });
  });

  it("rejects non-controlled origins and invalid challenge deadlines before opening", () => {
    const webView = {};
    const base = {
      origin,
      transactionId,
      configId,
      nonce,
      siteKey: "0x4AAAAAAFH-twNe8j1RAA09",
      expiresAt: 121_000,
      webView,
      now: () => 1_000,
    };
    expect(() =>
      createCaptchaWebViewBridge({
        ...base,
        origin: "https://customer.example",
      }),
    ).toThrow("Invalid Captcha bridge context");
    expect(() =>
      createCaptchaWebViewBridge({ ...base, expiresAt: 121_001 }),
    ).toThrow("Invalid Captcha bridge context");
    expect(() =>
      createCaptchaWebViewBridge({ ...base, nonce: "short" }),
    ).toThrow("Invalid Captcha bridge context");
  });
});
