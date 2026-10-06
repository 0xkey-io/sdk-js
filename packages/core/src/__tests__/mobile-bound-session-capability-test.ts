import { beforeEach, expect, it, jest } from "@jest/globals";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import { MobileStorageManager } from "../__storage__/mobile/storage";

const asyncStorage: any = jest.requireMock(
  "@react-native-async-storage/async-storage",
);
const values = new Map<string, string>();
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

beforeEach(() => {
  values.clear();
  jest.clearAllMocks();
  asyncStorage.getItem.mockImplementation(
    async (key: string) => values.get(key) ?? null,
  );
  asyncStorage.setItem.mockImplementation(
    async (key: string, value: string) => {
      values.set(key, value);
    },
  );
  asyncStorage.removeItem.mockImplementation(async (key: string) => {
    values.delete(key);
  });
});

it("does not cold-restore an unbound v2 session on RN", async () => {
  const old = new MobileStorageManager();
  await old.storeSession(token);
  expect((await old.getActiveSession())?.token).toBe(token);

  const cold = new MobileStorageManager();
  cold.restrictToNewSessions();
  expect(await cold.bindTarget(target)).toBe(false);
  expect(await cold.getActiveSession()).toBeUndefined();
  expect(await cold.listSessionKeys()).toEqual([]);
});

it("shows why getItem plus setItem cannot implement the v3 transaction", async () => {
  const recordKey = "@0xkey-io/auth/v3/candidate";
  let reads = 0;
  let releaseReads!: () => void;
  const bothReading = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  asyncStorage.getItem.mockImplementation(async (key: string) => {
    const observed = values.get(key) ?? null;
    if (key === recordKey) {
      reads += 1;
      if (reads === 2) releaseReads();
      await bothReading;
    }
    return observed;
  });
  const naiveWrite = async (sessionKey: string) => {
    const prior = JSON.parse(
      (await asyncStorage.getItem(recordKey)) ?? '{"sessions":[]}',
    );
    prior.sessions.push(sessionKey);
    await asyncStorage.setItem(recordKey, JSON.stringify(prior));
  };
  await Promise.all([naiveWrite("A"), naiveWrite("B")]);
  expect(reads).toBe(2);
  expect(JSON.parse(values.get(recordKey)!).sessions).toHaveLength(1);
});

it("shows why getItem plus removeItem cannot conditionally clear a replaced token", async () => {
  const recordKey = "@0xkey-io/auth/v3/candidate";
  values.set(recordKey, "token-A");
  const observed = await asyncStorage.getItem(recordKey);
  expect(observed).toBe("token-A");

  // Another JS runtime replaces the record before this stale clear executes.
  await asyncStorage.setItem(recordKey, "token-B");
  if (observed === "token-A") await asyncStorage.removeItem(recordKey);
  expect(values.has(recordKey)).toBe(false);
});
