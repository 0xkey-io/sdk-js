import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import WindowWrapper from "@polyfills/window";
import { WebStorageManager } from "../__storage__/web/storage";
import { prepareAuthStorage } from "../__storage__/auth-reset";

const raw = new Map<string, string>();
const pk = "036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296";
const claims = {
  exp: 1,
  public_key: pk,
  session_type: "SESSION_TYPE_READ_WRITE",
  user_id: "u",
  organization_id: "o",
};
const token = `header.${Buffer.from(JSON.stringify(claims)).toString("base64")}.signature`;
const session = {
  token,
  publicKey: pk,
  expiry: 1,
  sessionType: claims.session_type,
  userId: "u",
  organizationId: "o",
};

beforeEach(() => {
  raw.clear();
  jest
    .spyOn(WindowWrapper.localStorage, "getItem")
    .mockImplementation((k) => raw.get(k) ?? null);
  jest
    .spyOn(WindowWrapper.localStorage, "setItem")
    .mockImplementation((k, v) => {
      raw.set(k, v);
    });
  jest
    .spyOn(WindowWrapper.localStorage, "removeItem")
    .mockImplementation((k) => {
      raw.delete(k);
    });
});

describe("v2 auth session isolation", () => {
  it("scopes each client to newly stored token identities without deleting prior sessions", async () => {
    const oldClient = new WebStorageManager();
    const newClient = new WebStorageManager();
    const newToken = `header.${Buffer.from(
      JSON.stringify({
        ...claims,
        user_id: "new-user",
        organization_id: "new-org",
      }),
    ).toString("base64")}.signature`;
    await oldClient.storeSession(token, "old-key");

    newClient.restrictToNewSessions();
    expect(await newClient.getActiveSession()).toBeUndefined();
    expect(await newClient.getSession("old-key")).toBeUndefined();
    expect(await newClient.listSessionKeys()).toEqual([]);

    await newClient.storeSession(newToken, "new-key");
    expect((await newClient.getActiveSession())?.token).toBe(newToken);
    expect(await newClient.listSessionKeys()).toEqual(["new-key"]);
    expect(await newClient.getSession("old-key")).toBeUndefined();
    expect((await oldClient.getSession("old-key"))?.token).toBe(token);

    await newClient.clearAllSessions();
    expect((await oldClient.getSession("old-key"))?.token).toBe(token);
    expect(await newClient.getActiveSession()).toBeUndefined();
  });

  it("stops accepting a bound key when another client replaces its token", async () => {
    const oldClient = new WebStorageManager();
    const newClient = new WebStorageManager();
    newClient.restrictToNewSessions();
    await newClient.storeSession(token, "shared-key");
    expect((await newClient.getActiveSession())?.token).toBe(token);

    const replacedToken = `header.${Buffer.from(
      JSON.stringify({
        ...claims,
        user_id: "replaced",
      }),
    ).toString("base64")}.signature`;
    await oldClient.storeSession(replacedToken, "shared-key");
    expect(await newClient.getActiveSession()).toBeUndefined();
    expect(await newClient.getSession("shared-key")).toBeUndefined();
  });

  it.each([undefined, "", null, 0])(
    "never adopts a malformed unbound record with token %s",
    async (malformedToken) => {
      raw.set(
        "@0xkey-io/auth/v2/session/old-key",
        JSON.stringify({ publicKey: pk, token: malformedToken }),
      );
      raw.set(
        "@0xkey-io/auth/v2/meta/all-session-keys",
        JSON.stringify(["old-key"]),
      );
      raw.set(
        "@0xkey-io/auth/v2/meta/active-session-key",
        JSON.stringify("old-key"),
      );
      const newClient = new WebStorageManager();
      newClient.restrictToNewSessions();

      expect(await newClient.getSession("old-key")).toBeUndefined();
      expect(await newClient.getActiveSession()).toBeUndefined();
      expect(await newClient.listSessionKeys()).toEqual([]);
    },
  );

  it.each([
    "custom",
    "@0xkey-io/all-session-keys",
    "@0xkey-io/active-session-key",
    "@0xkey-io/auth-reset/v2",
    "@0xkey-io/auth/v2/",
  ])(
    "keeps logical key %s separate from metadata and raw application values",
    async (key) => {
      raw.set(key, "application-value");
      const storage = new WebStorageManager();
      await storage.storeSession(token, key);
      expect(raw.get(key)).toBe("application-value");
      expect(await storage.getSession(key)).toMatchObject(session);
      expect(await storage.getActiveSessionKey()).toBe(key);
      expect(await storage.listSessionKeys()).toEqual([key]);
      await storage.clearAllSessions();
      expect(await storage.getSession(key)).toBeUndefined();
      expect(raw.get(key)).toBe("application-value");
    },
  );
});

describe("one-time owned legacy auth reset", () => {
  it.each([
    ["marker", "read_marker"],
    ["legacy", "read_legacy"],
    ["keys", "clear_keys"],
    ["sessions", "clear_sessions"],
    ["complete", "write_marker"],
  ])(
    "classifies %s failure without leaking storage contents",
    async (failure, stage) => {
      const fail = () => {
        throw new Error("synthetic-secret-token");
      };
      const error = await prepareAuthStorage({
        identity: {},
        get: async (key) => {
          if (failure === "marker" && key === "@0xkey-io/auth-reset/v2") fail();
          if (failure === "legacy" && key === "@0xkey-io/all-session-keys")
            fail();
          return null;
        },
        cleanup: async () => {
          if (failure === "keys") fail();
        },
        remove: async () => {
          if (failure === "sessions") fail();
        },
        set: async () => {
          if (failure === "complete") fail();
        },
      }).catch((error) => error);
      expect(error).toMatchObject({
        code: "LOCAL_AUTH_RESET_FAILED",
        stage,
        retryable: true,
      });
      expect(String(error) + JSON.stringify(error)).not.toContain(
        "synthetic-secret-token",
      );
      expect(error.cause).toBeUndefined();
    },
  );
  it("never treats standalone sdk-browser records as migration targets", async () => {
    raw.set(
      "@0xkey-io/all-session-keys",
      JSON.stringify(["@0xkey-io/session/v2", "@0xkey-io/client"]),
    );
    raw.set("@0xkey-io/session/v2", JSON.stringify(session));
    raw.set("@0xkey-io/client", JSON.stringify(session));
    await reset(async (keys) => {
      expect(keys).toEqual([]);
    });
    expect(raw.get("@0xkey-io/session/v2")).toBe(JSON.stringify(session));
    expect(raw.get("@0xkey-io/client")).toBe(JSON.stringify(session));
  });
  it.each([
    "get:@0xkey-io/auth-reset/v2",
    "get:@0xkey-io/all-session-keys",
    "get:@0xkey-io/active-session-key",
    "get:@0xkey-io/session/v3",
    "get:custom",
    "remove:custom",
    "remove:@0xkey-io/session/v3",
    "remove:@0xkey-io/all-session-keys",
    "remove:@0xkey-io/active-session-key",
    "set:@0xkey-io/auth-reset/v2",
  ])("fails closed and retries after %s fails", async (failure) => {
    raw.set("@0xkey-io/all-session-keys", JSON.stringify(["custom"]));
    raw.set("custom", JSON.stringify(session));
    raw.set("@0xkey-io/auth/v2/session/new", "new-session");
    let failing = true;
    const operation = (name: string) => {
      if (failing && name === failure) throw new Error("secret-storage-error");
    };
    const adapter = () => ({
      identity: raw,
      get: async (key: string) => {
        operation(`get:${key}`);
        return raw.get(key) ?? null;
      },
      set: async (key: string, value: string) => {
        operation(`set:${key}`);
        raw.set(key, value);
      },
      remove: async (key: string) => {
        operation(`remove:${key}`);
        raw.delete(key);
      },
      cleanup: async () => {},
    });
    await expect(prepareAuthStorage(adapter())).rejects.toThrow(
      "Local authentication reset failed",
    );
    expect(raw.has("@0xkey-io/auth-reset/v2")).toBe(false);
    expect(raw.get("@0xkey-io/auth/v2/session/new")).toBe("new-session");
    failing = false;
    await prepareAuthStorage(adapter());
    expect(raw.get("@0xkey-io/auth-reset/v2")).toBe("complete");
    expect(raw.get("@0xkey-io/auth/v2/session/new")).toBe("new-session");
  });
  it("shares a backing-store barrier across managers without caching marker success forever", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let cleanups = 0;
    const adapter = () => ({
      identity: raw,
      get: async (k: string) => raw.get(k) ?? null,
      set: async (k: string, v: string) => {
        raw.set(k, v);
      },
      remove: async (k: string) => {
        raw.delete(k);
      },
      cleanup: async () => {
        cleanups++;
        await gate;
      },
    });
    const first = prepareAuthStorage(adapter());
    const second = prepareAuthStorage(adapter());
    expect(first).toBe(second);
    release();
    await first;
    await second;
    expect(cleanups).toBe(1);
    const manager = new WebStorageManager();
    await manager.storeSession(token, "new-login");
    // Old tab writes its own generation, then its historical raw session sweeper runs.
    raw.set("new-login", JSON.stringify(session));
    raw.set("@0xkey-io/all-session-keys", JSON.stringify(["new-login"]));
    raw.delete("new-login");
    raw.delete("@0xkey-io/all-session-keys");
    await prepareAuthStorage(adapter());
    expect(cleanups).toBe(1);
    raw.delete("@0xkey-io/auth-reset/v2");
    await prepareAuthStorage(adapter());
    expect(cleanups).toBe(2);
    expect(await manager.getSession("new-login")).toMatchObject(session);
  });
  it.each([
    { ...session, sessionType: "unknown" },
    { ...session, expiry: "1" },
    { ...session, userId: 1 },
    { ...session, publicKey: "looks-like-a-key" },
    { ...session, token: "malformed" },
    [session],
    null,
  ])("retains invalid ownership records %#", async (value) => {
    raw.set("@0xkey-io/active-session-key", JSON.stringify("custom"));
    raw.set("custom", JSON.stringify(value));
    await reset(async (keys) => {
      expect(keys).toEqual([]);
    });
    expect(raw.get("custom")).toBe(JSON.stringify(value));
  });
  async function reset(
    cleanup: (keys: string[]) => Promise<void> = async () => {},
  ) {
    const { prepareAuthStorage } = await import("../__storage__/auth-reset");
    return prepareAuthStorage({
      identity: raw,
      get: async (k) => raw.get(k) ?? null,
      set: async (k, v) => {
        raw.set(k, v);
      },
      remove: async (k) => {
        raw.delete(k);
      },
      cleanup,
    });
  }
  it("deletes associated keys before sessions and marks completion last", async () => {
    raw.set("custom", JSON.stringify(session));
    raw.set(
      "@0xkey-io/all-session-keys",
      JSON.stringify([
        "custom",
        "unowned",
        "@0xkey-io/auth/v2/session/new",
        "@0xkey-io/auth-reset/v2",
      ]),
    );
    raw.set("unowned", JSON.stringify({ publicKey: pk }));
    raw.set("@0xkey-io/auth/v2/session/new", "new-login");
    await reset(async (keys) => {
      expect(keys).toEqual([pk]);
      expect(raw.has("custom")).toBe(true);
      expect(raw.has("@0xkey-io/auth-reset/v2")).toBe(false);
    });
    expect(raw.has("custom")).toBe(false);
    expect(raw.get("@0xkey-io/auth-reset/v2")).toBe("complete");
    expect(raw.get("@0xkey-io/auth/v2/session/new")).toBe("new-login");
    expect(raw.has("unowned")).toBe(true);
    await reset(async () => {
      throw new Error("must not enumerate again");
    });
    raw.delete("@0xkey-io/auth-reset/v2");
    await reset();
    expect(raw.get("@0xkey-io/auth/v2/session/new")).toBe("new-login");
  });
  it("preserves changed custom records and malformed or inconsistent records", async () => {
    raw.set(
      "@0xkey-io/all-session-keys",
      JSON.stringify(["changed", "inconsistent", "invalid"]),
    );
    raw.set("changed", JSON.stringify(session));
    raw.set(
      "inconsistent",
      JSON.stringify({ ...session, userId: "different" }),
    );
    raw.set("invalid", "secret-broken-json");
    await reset(async () => {
      raw.set("changed", "application-replacement");
    });
    expect(raw.get("changed")).toBe("application-replacement");
    expect(raw.has("inconsistent")).toBe(true);
    expect(raw.has("invalid")).toBe(true);
  });
  it("does not mark cleanup failure and permits retry", async () => {
    raw.set("@0xkey-io/session/v3", JSON.stringify(session));
    await expect(
      reset(async () => {
        throw new Error("storage error");
      }),
    ).rejects.toThrow();
    expect(raw.has("@0xkey-io/session/v3")).toBe(true);
    expect(raw.has("@0xkey-io/auth-reset/v2")).toBe(false);
    await reset();
    expect(raw.has("@0xkey-io/session/v3")).toBe(false);
  });
});
