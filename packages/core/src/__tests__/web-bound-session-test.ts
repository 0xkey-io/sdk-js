import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import WindowWrapper from "@polyfills/window";
import { WebStorageManager } from "../__storage__/web/storage";

const targetA = {
  organizationId: "org-A",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
  authProxyConfigId: "config-A",
};
const targetB = { ...targetA, organizationId: "org-B" };
const token = (user: string) =>
  `header.${Buffer.from(
    JSON.stringify({
      exp: 2_000_000_000,
      public_key: `${user}-key`,
      session_type: "SESSION_TYPE_READ_WRITE",
      user_id: user,
      organization_id: "child-org",
    }),
  ).toString("base64url")}.signature`;

function indexedDbFixture() {
  const records = new Map<string, unknown>();
  let hasStore = false;
  let tail = Promise.resolve();
  let heldCommit: (() => void) | undefined;
  let commitQueued: (() => void) | undefined;
  let notifyQueued: (() => void) | undefined;
  const commitQueuedPromise = () =>
    new Promise<void>((resolve) => {
      notifyQueued = resolve;
    });
  const holdNextCommit = () => {
    const entered = commitQueuedPromise();
    heldCommit = () => undefined;
    return {
      entered,
      release: () => {
        heldCommit = undefined;
        commitQueued?.();
      },
    };
  };
  const db = {
    objectStoreNames: { contains: () => hasStore },
    createObjectStore: () => {
      hasStore = true;
    },
    close: () => undefined,
    transaction: (_store: string, _mode: string) => {
      let unlock!: () => void;
      const previous = tail;
      tail = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      let finished = false;
      let staged: { key: string; value: unknown; remove?: boolean } | undefined;
      const tx: any = {
        abort: () => {
          if (finished) throw new Error("Transaction already completed");
          finished = true;
          queueMicrotask(() => {
            tx.onabort?.();
            unlock();
          });
        },
        objectStore: () => ({
          get: (key: string) => {
            const request: any = {};
            void previous.then(() => {
              queueMicrotask(() => {
                if (finished) return;
                request.result = records.get(key);
                request.onsuccess?.();
                queueMicrotask(queueCommit);
              });
            });
            return request;
          },
          put: (value: unknown, key: string) => {
            staged = { key, value };
            return {};
          },
          delete: (key: string) => {
            staged = { key, value: undefined, remove: true };
            return {};
          },
        }),
      };
      const commit = () => {
        if (finished) return;
        finished = true;
        if (staged?.remove) records.delete(staged.key);
        else if (staged) records.set(staged.key, staged.value);
        tx.oncomplete?.();
        unlock();
      };
      const queueCommit = () => {
        if (finished) return;
        if (heldCommit) {
          commitQueued = commit;
          notifyQueued?.();
          notifyQueued = undefined;
        } else queueMicrotask(commit);
      };
      return tx;
    },
  };
  const factory = {
    open: () => {
      const request: any = { result: db };
      queueMicrotask(() => {
        if (!hasStore) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, records, holdNextCommit };
}

let fixture: ReturnType<typeof indexedDbFixture>;
const raw = new Map<string, string>();
beforeEach(() => {
  fixture = indexedDbFixture();
  raw.clear();
  (globalThis as any).indexedDB = fixture.factory;
  jest
    .spyOn(WindowWrapper.localStorage, "getItem")
    .mockImplementation((key) => raw.get(key) ?? null);
  jest
    .spyOn(WindowWrapper.localStorage, "setItem")
    .mockImplementation((key, value) => {
      raw.set(key, value);
    });
  jest
    .spyOn(WindowWrapper.localStorage, "removeItem")
    .mockImplementation((key) => {
      raw.delete(key);
    });
});
afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).indexedDB;
});

async function bound(target = targetA) {
  const manager = new WebStorageManager();
  manager.restrictToNewSessions();
  expect(await manager.bindTarget(target)).toBe(true);
  return manager;
}

it("restores only the exact Web target after a cold mount", async () => {
  const first = await bound();
  await first.storeSession(token("A"));
  const reload = await bound();
  expect((await reload.getActiveSession())?.token).toBe(token("A"));
  const other = await bound(targetB);
  expect(await other.getActiveSession()).toBeUndefined();
  expect([...raw.keys()].some((key) => key.includes("auth/v3"))).toBe(false);
});

it("serializes same-target Web writes across independent manager instances", async () => {
  const first = await bound();
  const second = await bound();
  await Promise.all([
    first.storeSession(token("A"), "session-A"),
    second.storeSession(token("B"), "session-B"),
  ]);
  const reload = await bound();
  expect((await reload.listSessionKeys()).sort()).toEqual([
    "session-A",
    "session-B",
  ]);
  await second.bindTarget(targetA);
  await second.storeSession(token("replacement"), "session-A");
  await first.clearSession("session-A");
  expect((await second.getSession("session-A"))?.token).toBe(
    token("replacement"),
  );
  expect(await first.getSession("session-A")).toBeUndefined();
});

it("stops an old tab from reading a replaced active token until a fresh bind", async () => {
  const oldTab = await bound();
  await oldTab.storeSession(token("old"));
  const newTab = await bound();
  await newTab.storeSession(token("new"));
  expect(await oldTab.getActiveSession()).toBeUndefined();
  expect(await oldTab.getSession()).toBeUndefined();
  expect((await newTab.getActiveSession())?.token).toBe(token("new"));
  await expect(oldTab.storeSession(token("stale"))).rejects.toBeDefined();
  expect((await newTab.getActiveSession())?.token).toBe(token("new"));

  const refreshedTab = await bound();
  expect((await refreshedTab.getActiveSession())?.token).toBe(token("new"));
});

it("aborts a queued Web transaction when its client retires", async () => {
  const first = await bound();
  const held = fixture.holdNextCommit();
  const pending = first.storeSession(token("A"));
  await held.entered;
  first.revokeAuthAccess();
  held.release();
  await expect(pending).rejects.toBeDefined();
  const reload = await bound();
  expect(await reload.getActiveSession()).toBeUndefined();
});
