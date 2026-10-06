import { expect, it } from "@jest/globals";
import { AuthStorageManager } from "../__storage__/auth-storage";
import { boundTargetKey } from "../__storage__/bound-session";
import type { RawAuthStorage } from "../__storage__/auth-reset";

const target = {
  organizationId: "org-A",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
};
const token = `header.${Buffer.from(
  JSON.stringify({
    exp: 2_000_000_000,
    public_key: "A-key",
    session_type: "SESSION_TYPE_READ_WRITE",
    user_id: "A-user",
    organization_id: "child-org",
  }),
).toString("base64url")}.signature`;

it("shows why JS abort alone cannot fence an already-dispatched native write", async () => {
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
  const nativeRecords = new Map<string, unknown>();
  let dispatched!: () => void;
  let commit!: () => void;
  const dispatchedPromise = new Promise<void>((resolve) => {
    dispatched = resolve;
  });
  const commitPromise = new Promise<void>((resolve) => {
    commit = resolve;
  });
  let signalAtCommit: AbortSignal | undefined;
  // This deliberately represents a native call that was already dispatched
  // when JS revoked the client. It is not a compliant atomic store.
  const nativeWithoutRetirementFence = {
    read: async (key: string) => nativeRecords.get(key),
    transact: async (
      key: string,
      update: (current: unknown) => unknown,
      signal: AbortSignal,
    ) => {
      const next = update(nativeRecords.get(key));
      dispatched();
      await commitPromise;
      signalAtCommit = signal;
      nativeRecords.set(key, next);
      return next;
    },
  };
  const old = new AuthStorageManager(raw, nativeWithoutRetirementFence);
  old.restrictToNewSessions();
  expect(await old.bindTarget(target)).toBe(true);
  const pending = old.storeSession(token);
  await dispatchedPromise;

  old.revokeAuthAccess();
  commit();
  await expect(pending).rejects.toThrow("Client auth context changed");
  expect(signalAtCommit?.aborted).toBe(true);

  const cold = new AuthStorageManager(raw, nativeWithoutRetirementFence);
  cold.restrictToNewSessions();
  expect(await cold.bindTarget(target)).toBe(true);
  expect((await cold.getActiveSession())?.token).toBe(token);
  expect(nativeRecords.has(boundTargetKey(target))).toBe(true);
});
