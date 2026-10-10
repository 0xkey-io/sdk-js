import { describe, expect, it } from "@jest/globals";
import { createCaptchaWebViewBridge } from "../utils/captcha-webview-bridge";
import { receiveCaptchaNativeMessage } from "../utils/captcha-webview-adapter";

const origin = "https://captcha.staging.0xkey.io";
const owner = {};
const fields = {
  type: "0xkey.captcha.result.v1",
  origin,
  transactionId: "transaction-1",
  configId: "5cc1732a-b599-43c8-a61e-041d1821d0fd",
  nonce: "abcdefghijklmnopqrstuvwxyz123456",
  expiresAt: 60_000,
  token: "opaque-token",
};

function setup() {
  return createCaptchaWebViewBridge({
    origin,
    transactionId: fields.transactionId,
    configId: fields.configId,
    nonce: fields.nonce,
    siteKey: "public-site-key",
    expiresAt: fields.expiresAt,
    webView: owner,
    now: () => 1_000,
  });
}

const android = {
  nativeEvent: {
    data: JSON.stringify(fields),
    captchaSourceKind: "android-web-message-listener",
    captchaSourceOrigin: origin,
    captchaIsMainFrame: true,
    captchaTopLevelUrl: `${origin}/`,
  },
};

describe("Captcha native WebView event adapter", () => {
  it("passes through independently supplied Android frame proof", () => {
    const bridge = setup();
    expect(receiveCaptchaNativeMessage(bridge, owner, android)).toEqual({
      kind: "accepted",
      token: "opaque-token",
    });
    expect(receiveCaptchaNativeMessage(bridge, owner, android)).toEqual({
      kind: "rejected",
      reason: "closed",
    });
  });

  it("passes through independently supplied iOS frame proof", () => {
    expect(
      receiveCaptchaNativeMessage(setup(), owner, {
        nativeEvent: {
          data: JSON.stringify(fields),
          captchaSourceKind: "ios-wk-script-message",
          captchaSourceFrameUrl: `${origin}/`,
          captchaIsMainFrame: true,
          captchaTopLevelUrl: `${origin}/`,
        },
      }),
    ).toEqual({ kind: "accepted", token: "opaque-token" });
  });

  it("rejects a different WebView owner without consuming the result", () => {
    const bridge = setup();
    expect(receiveCaptchaNativeMessage(bridge, {}, android)).toEqual({
      kind: "rejected",
      reason: "source",
    });
    expect(receiveCaptchaNativeMessage(bridge, owner, android).kind).toBe(
      "accepted",
    );
  });

  it.each([
    [
      "stock event",
      { nativeEvent: { data: android.nativeEvent.data, url: `${origin}/` } },
    ],
    [
      "Android fallback",
      {
        nativeEvent: {
          data: android.nativeEvent.data,
          url: `${origin}/`,
          captchaTopLevelUrl: `${origin}/`,
        },
      },
    ],
    [
      "subframe",
      { nativeEvent: { ...android.nativeEvent, captchaIsMainFrame: false } },
    ],
    [
      "navigated",
      {
        nativeEvent: {
          ...android.nativeEvent,
          captchaTopLevelUrl: `${origin}/?next=1`,
        },
      },
    ],
    [
      "wrong owner URL",
      {
        nativeEvent: {
          ...android.nativeEvent,
          captchaTopLevelUrl: "https://evil.example/",
        },
      },
    ],
    [
      "iOS same-URL subframe",
      {
        nativeEvent: {
          data: android.nativeEvent.data,
          captchaSourceKind: "ios-wk-script-message",
          captchaSourceFrameUrl: `${origin}/`,
          captchaIsMainFrame: false,
          captchaTopLevelUrl: `${origin}/`,
        },
      },
    ],
  ])("rejects %s without consuming valid result", (_label, event) => {
    const bridge = setup();
    expect(receiveCaptchaNativeMessage(bridge, owner, event)).toMatchObject({
      kind: "rejected",
    });
    expect(receiveCaptchaNativeMessage(bridge, owner, android)).toEqual({
      kind: "accepted",
      token: "opaque-token",
    });
  });

  it("contains malformed event getter failures", () => {
    const bridge = setup();
    const event = Object.defineProperty({}, "nativeEvent", {
      get() {
        throw new Error("bad getter");
      },
    });
    expect(receiveCaptchaNativeMessage(bridge, owner, event)).toEqual({
      kind: "rejected",
      reason: "provenance",
    });
    expect(receiveCaptchaNativeMessage(bridge, owner, android).kind).toBe(
      "accepted",
    );
  });
});
