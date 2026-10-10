import { describe, expect, it, jest } from "@jest/globals";
import { AuthStorageManager } from "../__storage__/auth-storage";
import { AUTH_ROOT } from "../__storage__/auth-reset";
import { CrossPlatformApiKeyStamper } from "../__stampers__/api/base";
import { ZeroXKeySDKClientBase } from "../__generated__/sdk-client-base";

const sessionKey = "@0xkey-io/session/v3";

describe("cold credential scope with malformed persistence", () => {
  it("never adopts a persisted session without a token for API-key signing", async () => {
    const raw = new Map<string, string>();
    const identity = {};
    raw.set(
      `${AUTH_ROOT}session/${sessionKey}`,
      JSON.stringify({
        publicKey: "A-key",
        organizationId: "org-A",
        userId: "user-A",
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    raw.set(`${AUTH_ROOT}meta/active-session-key`, JSON.stringify(sessionKey));
    raw.set(`${AUTH_ROOT}meta/all-session-keys`, JSON.stringify([sessionKey]));
    const storage = new AuthStorageManager({
      identity,
      get: async (key) => raw.get(key) ?? null,
      set: async (key, value) => {
        raw.set(key, value);
      },
      remove: async (key) => {
        raw.delete(key);
      },
      cleanup: async () => undefined,
    });
    storage.restrictToNewSessions();
    const stamp = jest.fn(async (_payload: string, publicKey: string) => ({
      stampHeaderName: "X-Test-Stamp",
      stampHeaderValue: publicKey,
    }));
    const stamper = new CrossPlatformApiKeyStamper(storage);
    (stamper as any).stamper = { stamp };
    const http = new ZeroXKeySDKClientBase({
      organizationId: "org-B",
      apiBaseUrl: "https://api.example.test",
      authProxyUrl: "https://auth.example.test",
      storageManager: storage,
      apiKeyStamper: stamper,
    });

    await expect(
      http.stampGetActivity({ activityId: "test" }),
    ).rejects.toBeDefined();
    expect(await storage.getActiveSession()).toBeUndefined();
    expect(stamp).not.toHaveBeenCalled();
  });
});
