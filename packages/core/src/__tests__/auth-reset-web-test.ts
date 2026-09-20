import { expect, it, jest } from "@jest/globals";
import { webcrypto } from "crypto";
import { IndexedDbStamper } from "../__stampers__/api/web/stamper";
import { SignatureFormat } from "@0xkey-io/api-key-stamper";
import { WebStorageManager } from "../__storage__/web/storage";
import WindowWrapper from "@polyfills/window";
import { prepareAuthStorage } from "../__storage__/auth-reset";
// The shared suite setup replaces subtle with a fake. Exercise actual CryptoKeys here.
const realSubtle = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(webcrypto),
  "subtle",
)!.get!.call(webcrypto) as SubtleCrypto;

// Real asynchronous request/transaction boundaries, with commit and abort isolation.
function database(
  rows: Map<string, unknown>,
  abort = false,
  hasStore = true,
  unrelated = new Map<string, unknown>(),
  options: {
    manualCommit?: boolean;
    deleteError?: boolean;
    deleteThrows?: boolean;
    abortThrows?: boolean;
  } = {},
) {
  let closed = 0;
  let openedVersion: number | undefined;
  let abortAttempts = 0;
  let completePending = () => {};
  const callbackErrors: unknown[] = [];
  const dispatch = (callback?: () => void) => {
    try {
      callback?.();
    } catch (error) {
      callbackErrors.push(error);
    }
  };
  const db = {
    onversionchange: null as null | (() => void),
    objectStoreNames: {
      contains: (name: string) =>
        name === "KeyStore" ? hasStore : name === "Unrelated",
    },
    close: () => {
      closed++;
    },
    transaction: (name: string) => {
      const target =
        name === "KeyStore"
          ? rows
          : name === "Unrelated"
            ? unrelated
            : undefined;
      if (!target) throw new Error("unknown store");
      const staged = new Set<string>();
      const writes = new Map<string, unknown>();
      let finished = false;
      const tx: any = {
        abort: () => {
          abortAttempts++;
          if (options.abortThrows || finished)
            throw new Error("Transaction is already finished");
          finished = true;
          staged.clear();
          writes.clear();
          queueMicrotask(() => dispatch(tx.onabort));
        },
        objectStore: () => ({
          get: (key: string) => {
            const request: any = {};
            queueMicrotask(() => {
              request.result = target.get(key);
              dispatch(request.onsuccess);
            });
            return request;
          },
          delete: (key: string) => {
            if (options.deleteThrows)
              throw new Error("Delete request failed synchronously");
            staged.add(key);
            const request: any = {};
            queueMicrotask(() =>
              dispatch(
                options.deleteError ? request.onerror : request.onsuccess,
              ),
            );
            return request;
          },
          put: (value: unknown, key: string) => {
            writes.set(key, value);
            return {};
          },
          getAllKeys: () => {
            const request: any = {};
            queueMicrotask(() => {
              request.result = [...target.keys()];
              request.onsuccess?.();
            });
            return request;
          },
        }),
      };
      completePending = () => {
        if (finished) return;
        finished = true;
        if (abort) dispatch(tx.onabort);
        else {
          staged.forEach((key) => target.delete(key));
          writes.forEach((value, key) => target.set(key, value));
          dispatch(tx.oncomplete);
        }
      };
      if (!options.manualCommit) setTimeout(completePending, 0);
      return tx;
    },
  };
  const factory = {
    open: (_name: string, version?: number) => {
      openedVersion = version;
      const request: any = { result: db };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  return {
    factory: factory as unknown as IDBFactory,
    closed: () => closed,
    version: () => openedVersion,
    commit: () => completePending(),
    versionchange: () => dispatch(db.onversionchange ?? undefined),
    abortAttempts: () => abortAttempts,
    callbackErrors,
  };
}

it.each(["timeout", "versionchange"])(
  "rolls back queued deletions after %s rejects cleanup",
  async (mode) => {
    const { cleanupLegacyWebKeys } = await import(
      "../__storage__/web/legacy-keys"
    );
    const pair = await realSubtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    );
    const rows = new Map<string, unknown>([["associated", pair.privateKey]]);
    const fake = database(rows, false, true, new Map(), { manualCommit: true });
    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
    try {
      const pending = cleanupLegacyWebKeys(["associated"], fake.factory);
      const rejected = expect(pending).rejects.toThrow(
        "Legacy key cleanup failed",
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      if (mode === "timeout") jest.advanceTimersByTime(5000);
      else fake.versionchange();
      await rejected;
      fake.commit();
      expect(rows.has("associated")).toBe(true);
      expect(fake.abortAttempts()).toBe(1);
      expect(fake.closed()).toBe(1);
      expect(fake.callbackErrors).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  },
);

it("aborts queued deletions on an asynchronous delete-request error", async () => {
  const { cleanupLegacyWebKeys } = await import(
    "../__storage__/web/legacy-keys"
  );
  const pair = await realSubtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const rows = new Map<string, unknown>([["associated", pair.privateKey]]);
  const fake = database(rows, false, true, new Map(), {
    manualCommit: true,
    deleteError: true,
  });
  const result = cleanupLegacyWebKeys(["associated"], fake.factory).then(
    () => "resolved",
    () => "rejected",
  );
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fake.commit();
  expect(await result).toBe("rejected");
  expect(rows.has("associated")).toBe(true);
  expect(fake.abortAttempts()).toBe(1);
  expect(fake.closed()).toBe(1);
  expect(fake.callbackErrors).toEqual([]);
});

it("closes and settles even when abort throws after a synchronous delete failure", async () => {
  const { cleanupLegacyWebKeys } = await import(
    "../__storage__/web/legacy-keys"
  );
  const pair = await realSubtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const rows = new Map<string, unknown>([["associated", pair.privateKey]]);
  const fake = database(rows, false, true, new Map(), {
    manualCommit: true,
    deleteThrows: true,
    abortThrows: true,
  });
  const result = cleanupLegacyWebKeys(["associated"], fake.factory).then(
    () => "resolved",
    () => "rejected",
  );
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fake.commit();
  expect(await result).toBe("rejected");
  expect(rows.has("associated")).toBe(true);
  expect(fake.abortAttempts()).toBe(1);
  expect(fake.closed()).toBe(1);
  expect(fake.callbackErrors).toEqual([]);
});

it("legacy web cleanup commits only associated private P256 rows and closes DB", async () => {
  const { cleanupLegacyWebKeys } = await import(
    "../__storage__/web/legacy-keys"
  );
  const pair = await realSubtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const rows = new Map<string, unknown>([
    ["associated", pair.privateKey],
    ["unassociated", pair.privateKey],
    ["unknown", { type: "private" }],
    ["public", pair.publicKey],
    ["0xkeyKeyPair-priv", pair.privateKey],
    ["0xkeyKeyPair-pub", pair.publicKey],
  ]);
  const fake = database(rows);
  await cleanupLegacyWebKeys(["associated", "unknown", "public"], fake.factory);
  expect([...rows.keys()].sort()).toEqual(
    [
      "unassociated",
      "unknown",
      "public",
      "0xkeyKeyPair-priv",
      "0xkeyKeyPair-pub",
    ].sort(),
  );
  expect(fake.closed()).toBe(1);
  expect(fake.version()).toBeUndefined();
});

it("new Web key still signs after another client prepares, an old tab sweeps, and marker loss retries", async () => {
  const raw = new Map<string, string>();
  const legacyRows = new Map<string, unknown>();
  const newRows = new Map<string, unknown>();
  const unrelatedStore = new Map([["application", "retained"]]);
  const oldPair = await realSubtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const oldKey =
    "036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296";
  const makeToken = (publicKey: string) =>
    `header.${Buffer.from(JSON.stringify({ exp: 1, public_key: publicKey, session_type: "SESSION_TYPE_READ_WRITE", user_id: "u", organization_id: "o" })).toString("base64")}.signature`;
  raw.set(
    "@0xkey-io/session/v3",
    JSON.stringify({
      token: makeToken(oldKey),
      publicKey: oldKey,
      expiry: 1,
      sessionType: "SESSION_TYPE_READ_WRITE",
      userId: "u",
      organizationId: "o",
    }),
  );
  legacyRows.set(oldKey, oldPair.privateKey);
  legacyRows.set("0xkeyKeyPair-priv", oldPair.privateKey);
  legacyRows.set("unassociated", oldPair.privateKey);
  const priorWindow = (globalThis as any).window;
  const priorDb = (globalThis as any).indexedDB;
  const priorSubtle = crypto.subtle;
  (globalThis as any).window = {};
  (globalThis as any).indexedDB = {
    open: (name: string, version?: number) => {
      if (name !== "ZeroXKeyStamperDB" && name !== "ZeroXKeyAuthV2")
        throw new Error("unexpected database");
      return database(
        name === "ZeroXKeyStamperDB" ? legacyRows : newRows,
        false,
        true,
        unrelatedStore,
      ).factory.open(name, version);
    },
  };
  Object.defineProperty(crypto, "subtle", {
    value: realSubtle,
    configurable: true,
  });
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
  try {
    const first = new WebStorageManager();
    await first.prepare();
    expect(await first.getSession()).toBeUndefined();
    expect(legacyRows.has(oldKey)).toBe(false);
    const stamper = new IndexedDbStamper();
    const key = await stamper.createKeyPair();
    await first.storeSession(makeToken(key), "login");
    const second = new WebStorageManager();
    await second.prepare();
    // A legacy client writes raw sessions and enumerates/deletes only its legacy DB.
    raw.set("login", "old-tab-session");
    raw.set("@0xkey-io/all-session-keys", '["login"]');
    legacyRows.set("old-tab-key", oldPair.privateKey);
    raw.delete("login");
    legacyRows.delete("old-tab-key");
    raw.delete("@0xkey-io/auth-reset/v2");
    await new WebStorageManager().prepare();
    expect((await second.getSession("login"))?.publicKey).toBe(key);
    expect(await stamper.listKeyPairs()).toEqual([key]);
    const signature = await stamper.sign(
      "still-signs",
      key,
      SignatureFormat.Raw,
    );
    expect(signature).toBeTruthy();
    expect(legacyRows.has("0xkeyKeyPair-priv")).toBe(true);
    expect(legacyRows.has("unassociated")).toBe(true);
    expect(unrelatedStore.get("application")).toBe("retained");
  } finally {
    jest.restoreAllMocks();
    (globalThis as any).window = priorWindow;
    (globalThis as any).indexedDB = priorDb;
    Object.defineProperty(crypto, "subtle", {
      value: priorSubtle,
      configurable: true,
    });
  }
});
it("legacy web abort rejects, retains rows, and closes DB", async () => {
  const { cleanupLegacyWebKeys } = await import(
    "../__storage__/web/legacy-keys"
  );
  const pair = await realSubtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const rows = new Map<string, unknown>([["associated", pair.privateKey]]);
  const fake = database(rows, true);
  const raw = new Map<string, string>();
  await expect(
    prepareAuthStorage({
      identity: raw,
      get: async (k) => raw.get(k) ?? null,
      set: async (k, v) => {
        raw.set(k, v);
      },
      remove: async (k) => {
        raw.delete(k);
      },
      cleanup: () => cleanupLegacyWebKeys(["associated"], fake.factory),
    }),
  ).rejects.toThrow();
  expect(raw.has("@0xkey-io/auth-reset/v2")).toBe(false);
  expect(rows.has("associated")).toBe(true);
  expect(fake.closed()).toBe(1);
});

it.each([
  "open-error",
  "transaction-throw",
  "transaction-error",
  "request-error",
  "versionchange",
])("closes and rejects on %s", async (mode) => {
  const { cleanupLegacyWebKeys } = await import(
    "../__storage__/web/legacy-keys"
  );
  const close = jest.fn();
  const read: any = {};
  const tx: any = { objectStore: () => ({ get: () => read }) };
  const db: any = {
    close,
    objectStoreNames: { contains: () => true },
    transaction: () => {
      if (mode === "transaction-throw") throw new Error("synthetic");
      return tx;
    },
  };
  const request: any = { result: db };
  const pending = cleanupLegacyWebKeys(["associated"], {
    open: () => request,
  } as unknown as IDBFactory);
  if (mode === "open-error") request.onerror();
  else {
    request.onsuccess();
    if (mode === "transaction-error") tx.onerror();
    if (mode === "request-error") read.onerror();
    if (mode === "versionchange") db.onversionchange();
  }
  await expect(pending).rejects.toThrow();
  expect(close).toHaveBeenCalledTimes(mode === "open-error" ? 0 : 1);
});

it("does not create an absent legacy database and bounds a stalled open", async () => {
  const { cleanupLegacyWebKeys } = await import(
    "../__storage__/web/legacy-keys"
  );
  const close = jest.fn();
  const abort = jest.fn();
  const request: any = { result: { close }, transaction: { abort } };
  const factory = { open: () => request } as unknown as IDBFactory;
  const absent = cleanupLegacyWebKeys(["associated"], factory);
  request.onupgradeneeded();
  request.onerror();
  await absent;
  expect(abort).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  jest.useFakeTimers();
  try {
    const stalled = cleanupLegacyWebKeys(["associated"], factory);
    const assertion = expect(stalled).rejects.toThrow();
    jest.advanceTimersByTime(5000);
    await assertion;
    request.onsuccess();
    expect(close).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});
it("handles missing store and blocked open without hanging; closes late success", async () => {
  const { cleanupLegacyWebKeys } = await import(
    "../__storage__/web/legacy-keys"
  );
  const missing = database(new Map(), false, false);
  await cleanupLegacyWebKeys(["associated"], missing.factory);
  expect(missing.closed()).toBe(1);
  const close = jest.fn();
  const request: any = { result: { close } };
  const promise = cleanupLegacyWebKeys(["associated"], {
    open: () => request,
  } as unknown as IDBFactory);
  request.onblocked();
  await expect(promise).rejects.toThrow();
  request.onsuccess();
  expect(close).toHaveBeenCalledTimes(1);
});
