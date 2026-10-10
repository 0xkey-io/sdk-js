import { describe, expect, it } from "@jest/globals";
import { permitsCaptchaNavigation } from "../utils/captcha-webview-navigation";

const origin = "https://captcha.staging.0xkey.io";

describe("Captcha WebView navigation", () => {
  it("allows the exact controlled root", () => {
    expect(permitsCaptchaNavigation(origin, { url: `${origin}/` })).toBe(true);
    expect(
      permitsCaptchaNavigation(origin, {
        url: `${origin}/`,
        isTopFrame: true,
      }),
    ).toBe(true);
  });

  it("allows a Cloudflare subframe only with an explicit native false flag", () => {
    const url = "https://challenges.cloudflare.com/cdn-cgi/challenge";
    expect(permitsCaptchaNavigation(origin, { url, isTopFrame: false })).toBe(
      true,
    );
    expect(permitsCaptchaNavigation(origin, { url, isTopFrame: true })).toBe(
      false,
    );
    expect(permitsCaptchaNavigation(origin, { url })).toBe(false);
  });

  it("rejects unknown top-level destinations with or without a frame flag", () => {
    for (const request of [
      { url: "https://evil.example/" },
      { url: "https://evil.example/", isTopFrame: true },
      { url: "intent://external", isTopFrame: true },
      { url: "about:blank" },
    ]) {
      expect(permitsCaptchaNavigation(origin, request)).toBe(false);
    }
  });

  it.each([
    `${origin}/?token=forbidden`,
    `${origin}/#fragment`,
    "https://captcha.staging.0xkey.io.evil.example/",
    "https://challenges.cloudflare.com.evil.example/",
    "http://challenges.cloudflare.com/cdn-cgi/challenge",
    "https://challenges.cloudflare.com:444/cdn-cgi/challenge",
    "https://evil.example/",
  ])("blocks non-root or untrusted navigation %s", (url) => {
    expect(permitsCaptchaNavigation(origin, { url, isTopFrame: false })).toBe(
      false,
    );
  });
});
