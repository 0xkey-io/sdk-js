import { describe, expect, it } from "@jest/globals";
import { AuthStorageManager } from "../__storage__/auth-storage";
import type { RawAuthStorage } from "../__storage__/auth-reset";

const defaultKey = "@0xkey-io/session/v3";
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

function fixture() {
  const rawValues = new Map<string, string>();
  const raw: RawAuthStorage = {
    identity: rawValues,
    get: async (key) => rawValues.get(key) ?? null,
    set: async (key, value) => {
      rawValues.set(key, value);
    },
    remove: async (key) => {
      rawValues.delete(key);
    },
    cleanup: async () => undefined,
  };
  const records = new Map<string, any>();
  let tail = Promise.resolve();
  let heldCommit: { entered: () => void; release: Promise<void> } | undefined;
  const holdNextCommit = () => {
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    heldCommit = { entered, release: releasePromise };
    return { entered: enteredPromise, release };
  };
  const clone = <T>(value: T): T =>
    value === undefined ? value : JSON.parse(JSON.stringify(value));
  const atomic = {
    read: async (key: string) => clone(records.get(key)),
    transact: (
      key: string,
      update: (current: any) => any,
      signal?: AbortSignal,
    ): Promise<any> => {
      const work = tail.then(async () => {
        const next = update(clone(records.get(key)));
        const hold = heldCommit;
        heldCommit = undefined;
        if (hold) {
          hold.entered();
          await hold.release;
        }
        if (signal?.aborted) throw new Error("Bound transaction aborted");
        if (next === undefined) records.delete(key);
        else records.set(key, clone(next));
        return clone(next);
      });
      tail = work.then(
        () => undefined,
        () => undefined,
      );
      return work;
    },
  };
  const manager = () =>
    new (AuthStorageManager as any)(raw, atomic) as AuthStorageManager & {
      bindTarget?: (target: typeof targetA) => Promise<boolean>;
    };
  const bind = async (
    storage: ReturnType<typeof manager>,
    target = targetA,
  ) => {
    storage.restrictToNewSessions();
    await storage.bindTarget?.(target);
  };
  return { raw, rawValues, atomic, manager, bind, holdNextCommit };
}

describe("atomic target-bound session contract", () => {
  it("restores a new bound session only for its exact constructor target", async () => {
    const { manager, bind } = fixture();
    const firstA = manager();
    await bind(firstA);
    await firstA.storeSession(token("A"));

    const reloadedA = manager();
    await bind(reloadedA);
    expect((await reloadedA.getActiveSession())?.token).toBe(token("A"));
    expect(await reloadedA.listSessionKeys()).toEqual([defaultKey]);

    const firstB = manager();
    await bind(firstB, targetB);
    expect(await firstB.getActiveSession()).toBeUndefined();
    expect(await firstB.listSessionKeys()).toEqual([]);
  });

  it("does not adopt an unbound v2 session even for the same target", async () => {
    const { raw, manager, bind } = fixture();
    const legacy = new AuthStorageManager(raw);
    await legacy.storeSession(token("legacy"));

    const reloadedA = manager();
    await bind(reloadedA);
    expect(await reloadedA.getActiveSession()).toBeUndefined();
    expect(await reloadedA.listSessionKeys()).toEqual([]);
    expect((await legacy.getActiveSession())?.token).toBe(token("legacy"));
  });

  it("merges concurrent writers across manager instances and compares before clear", async () => {
    const { manager, bind } = fixture();
    const first = manager();
    const second = manager();
    await Promise.all([bind(first), bind(second)]);
    await Promise.all([
      first.storeSession(token("A"), "session-A"),
      second.storeSession(token("B"), "session-B"),
    ]);

    const reloaded = manager();
    await bind(reloaded);
    expect((await reloaded.listSessionKeys()).sort()).toEqual([
      "session-A",
      "session-B",
    ]);
    expect((await reloaded.getSession("session-A"))?.token).toBe(token("A"));
    expect((await reloaded.getSession("session-B"))?.token).toBe(token("B"));

    await second.bindTarget?.(targetA);
    await second.storeSession(token("replacement"), "session-A");
    await first.clearSession("session-A");
    expect((await second.getSession("session-A"))?.token).toBe(
      token("replacement"),
    );
  });

  it("reads the active key and token from one bound record snapshot", async () => {
    const { manager, bind, atomic } = fixture();
    const first = manager();
    await bind(first);
    await first.storeSession(token("A"), "session-A");
    await first.storeSession(token("B"), "session-B");
    await first.setActiveSessionKey("session-A");

    const originalRead = atomic.read;
    let switchAfterFirstRead = true;
    atomic.read = async (key) => {
      const snapshot = await originalRead(key);
      if (switchAfterFirstRead) {
        switchAfterFirstRead = false;
        await atomic.transact(key, (record: any) => ({
          ...record,
          sessions: record.sessions.filter(
            (session: { key: string }) => session.key !== "session-A",
          ),
          activeSessionKey: "session-B",
        }));
      }
      return snapshot;
    };

    // The overlapping read can linearize before the completed B transaction.
    expect((await first.getActiveSession())?.token).toBe(token("A"));
    // This read starts after B committed and must observe B.
    expect((await first.getActiveSession())?.token).toBe(token("B"));
  });

  it("aborts an in-flight store or clear before commit when its client retires", async () => {
    const { manager, bind, holdNextCommit } = fixture();
    const first = manager();
    await bind(first);
    const heldStore = holdNextCommit();
    const pendingStore = first.storeSession(token("A"));
    await heldStore.entered;
    first.revokeAuthAccess();
    heldStore.release();
    await expect(pendingStore).rejects.toBeDefined();

    const fresh = manager();
    await bind(fresh);
    expect(await fresh.getActiveSession()).toBeUndefined();
    await fresh.storeSession(token("B"));

    const heldClear = holdNextCommit();
    const pendingClear = fresh.clearSession(defaultKey);
    await heldClear.entered;
    fresh.revokeAuthAccess();
    heldClear.release();
    await expect(pendingClear).rejects.toBeDefined();

    const reloaded = manager();
    await bind(reloaded);
    expect((await reloaded.getActiveSession())?.token).toBe(token("B"));
  });
});
