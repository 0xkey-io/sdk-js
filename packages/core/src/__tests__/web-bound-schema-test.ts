import { afterEach, expect, it } from "@jest/globals";
import { WebAtomicBoundSessionStore } from "../__storage__/web/bound-session";

afterEach(() => {
  delete (globalThis as any).indexedDB;
});

it("upgrades a v1 BoundSessions database and opens one four-store write transaction", async () => {
  const names = new Set(["BoundSessions"]);
  let openedVersion: number | undefined;
  let transactionScope: string[] | undefined;
  let closeCount = 0;
  const writes: string[] = [];
  const db: any = {
    objectStoreNames: { contains: (name: string) => names.has(name) },
    createObjectStore: (name: string) => {
      names.add(name);
    },
    close: () => {
      closeCount += 1;
    },
    transaction: (stores: string[], mode: string) => {
      transactionScope = stores;
      expect(mode).toBe("readwrite");
      const tx: any = {
        objectStore: (name: string) => ({
          put: (_value: unknown, key: string) => {
            writes.push(`${name}:${key}`);
          },
        }),
        abort: () => tx.onabort?.(),
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
  (globalThis as any).indexedDB = {
    open: (_name: string, version: number) => {
      openedVersion = version;
      const request: any = { result: db };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  await (new WebAtomicBoundSessionStore() as any).withCredentialTransaction(
    ({ sessions, keys, owners, meta }: any) => {
      sessions.put({ version: 3 }, "target-A");
      keys.put("synthetic-key", "public-key");
      owners.put({ pending: true }, "public-key");
      meta.put(1, "epoch");
    },
    new AbortController().signal,
  );

  expect(openedVersion).toBe(2);
  expect([...names].sort()).toEqual(
    ["BoundSessions", "KeyStore", "KeyOwners", "Meta"].sort(),
  );
  expect(transactionScope?.sort()).toEqual([...names].sort());
  expect(writes.sort()).toEqual(
    [
      "BoundSessions:target-A",
      "KeyStore:public-key",
      "KeyOwners:public-key",
      "Meta:epoch",
    ].sort(),
  );
  db.onversionchange?.();
  expect(closeCount).toBe(2);
});

it("fails closed on a blocked v3 schema upgrade and closes a late connection", async () => {
  let closeCount = 0;
  const db = { close: () => (closeCount += 1) };
  let request: any;
  (globalThis as any).indexedDB = {
    open: () => {
      request = { result: db };
      queueMicrotask(() => request.onblocked?.());
      return request;
    },
  };
  await expect(
    new WebAtomicBoundSessionStore().read("target-A"),
  ).rejects.toThrow("blocked");
  request.onsuccess?.();
  expect(closeCount).toBe(1);
});
