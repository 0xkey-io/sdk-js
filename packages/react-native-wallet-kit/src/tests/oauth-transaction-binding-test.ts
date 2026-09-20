import { describe, expect, it } from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import {
  createOAuthTransactionStore,
  type BeginOAuthTransactionInput,
  type OAuthTransactionSecureStorage,
} from "../utils/oauth-transaction";

const id = "01010101010101010101010101010101";
const key = `0xkey.oauth.transaction.v1.${id}`;
// Opaque ordered routing fields are produced by the future trusted coordinator.
const routing = [
  "client-1",
  "https://provider.test/callback",
  "app://",
  "org-1",
  "https://exchange.test",
  "redirect",
];
const context = {
  configId: "config-1",
  provider: OAuthProviders.GOOGLE,
  binding: JSON.stringify(routing),
};
const input = {
  ...context,
  publicKey: "public-key-1",
  expectedState: "original-state",
  codeVerifier: "verifier-secret-1",
};

class Storage implements OAuthTransactionSecureStorage {
  readonly values = new Map<string, string>();
  readonly mutations: string[] = [];
  failSet = false;
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.mutations.push("set");
    if (this.failSet) throw new Error("storage-secret");
    this.values.set(key, value);
  }
  async remove(key: string) {
    this.mutations.push("remove");
    this.values.delete(key);
  }
}

function harness(storage = new Storage()) {
  const keys = new Set([input.publicKey, "unrelated-key"]);
  const cleanupAttempts: string[] = [];
  const controls = { now: 1_000, clockThrows: false, cleanupFails: false };
  const store = createOAuthTransactionStore({
    secureStorage: storage,
    randomBytes: () => new Uint8Array(16).fill(1),
    now: () => {
      if (controls.clockThrows) throw new Error("clock-secret");
      return controls.now;
    },
    cleanupTemporaryKey: async (publicKey) => {
      cleanupAttempts.push(publicKey);
      if (controls.cleanupFails) throw new Error("cleanup-secret");
      keys.delete(publicKey);
    },
  });
  return { store, storage, keys, cleanupAttempts, controls };
}

function deferGet(storage: Storage) {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  storage.get = async (key) => {
    entered();
    await pending;
    return storage.values.get(key) ?? null;
  };
  return { started, release };
}

describe("OAuth transaction routing binding", () => {
  it.each(["live", "expired", "tombstone", "intent", "contextless-intent"])(
    "checks every changed routing field before %s state, expiry, or cleanup work",
    async (kind) => {
      const h = harness();
      await h.store.beginOAuthTransaction(input);
      if (kind === "expired") h.controls.now = 301_000;
      if (["tombstone", "intent", "contextless-intent"].includes(kind)) {
        h.controls.cleanupFails = true;
        h.storage.failSet = kind !== "tombstone";
        await expect(h.store.cancelOAuthTransaction(id)).rejects.toThrow(
          "OAuth transaction cleanup failed",
        );
        h.controls.cleanupFails = false;
        h.storage.failSet = false;
        if (kind === "contextless-intent") h.storage.values.set(key, "{}");
      }
      // Tombstone checks must work from bytes with no volatile intent.
      const resumed = kind === "tombstone" ? harness() : h;
      if (resumed !== h)
        for (const [k, v] of h.storage.values) resumed.storage.values.set(k, v);
      resumed.cleanupAttempts.length = 0;
      resumed.storage.mutations.length = 0;
      const original = [...resumed.storage.values];
      for (let field = 0; field < routing.length; field++) {
        const changed = [...routing];
        changed[field] += "-changed";
        const foreign = { ...context, binding: JSON.stringify(changed) };
        for (const state of [input.expectedState, "wrong-state"]) {
          await expect(
            resumed.store.consumeOAuthTransaction(id, state, foreign),
          ).rejects.toThrow("OAuth transaction unavailable");
          expect([...resumed.storage.values]).toEqual(original);
          expect(resumed.storage.mutations).toEqual([]);
          expect(resumed.cleanupAttempts).toEqual([]);
          expect([...resumed.keys]).toEqual(["public-key-1", "unrelated-key"]);
        }
      }
      const rightful = resumed.store.consumeOAuthTransaction(
        id,
        input.expectedState,
        context,
      );
      if (kind === "live") {
        await expect(rightful).resolves.toMatchObject({
          binding: context.binding,
          codeVerifier: "verifier-secret-1",
        });
        expect([...resumed.keys]).toEqual(["public-key-1", "unrelated-key"]);
      } else {
        await expect(rightful).rejects.toThrow("OAuth transaction unavailable");
        expect([...resumed.keys]).toEqual(["unrelated-key"]);
      }
      expect(resumed.storage.values.size).toBe(0);
    },
  );

  it("persists binding in begin metadata and reconstructs it for consume", async () => {
    const h = harness();
    const metadata = await h.store.beginOAuthTransaction(input);
    expect(metadata).toMatchObject({ binding: context.binding });
    metadata.binding = "caller-mutated";
    const resumed = harness();
    for (const [k, v] of h.storage.values) resumed.storage.values.set(k, v);
    await expect(
      resumed.store.consumeOAuthTransaction(id, input.expectedState, context),
    ).resolves.toMatchObject({
      binding: context.binding,
      codeVerifier: "verifier-secret-1",
    });
  });

  it.each([undefined, "", null, 7, {}])(
    "rejects malformed trusted binding %p before I/O",
    async (binding) => {
      const h = harness();
      h.storage.get = async () => {
        throw new Error("must not read");
      };
      await expect(
        h.store.beginOAuthTransaction({ ...input, binding } as never),
      ).rejects.toThrow("OAuth transaction invalid");
      await expect(
        h.store.consumeOAuthTransaction(id, input.expectedState, {
          ...context,
          binding,
        } as never),
      ).rejects.toThrow("OAuth transaction invalid");
      expect(h.storage.mutations).toEqual([]);
      expect(h.cleanupAttempts).toEqual([]);
    },
  );

  it.each(["transaction", "cleanup-pending"])(
    "retains legacy/malformed binding in %s records on consume and selection",
    async (kind) => {
      for (const binding of [undefined, "", null, 7, {}]) {
        const h = harness();
        h.storage.values.set(
          key,
          JSON.stringify({ ...input, binding, kind, id, expiresAt: 301_000 }),
        );
        const original = [...h.storage.values];
        await expect(
          h.store.consumeOAuthTransaction(id, input.expectedState, context),
        ).rejects.toThrow("OAuth transaction unavailable");
        await expect(
          h.store.getOAuthTransactionContext(id),
        ).resolves.toBeNull();
        expect([...h.storage.values]).toEqual(original);
        expect(h.storage.mutations).toEqual([]);
        expect(h.cleanupAttempts).toEqual([]);
      }
    },
  );

  it("retains trusted exact-ID cancellation of a malformed binding without inferring its key", async () => {
    const h = harness();
    h.storage.values.set(
      key,
      JSON.stringify({
        ...input,
        binding: undefined,
        kind: "transaction",
        id,
        expiresAt: 301_000,
      }),
    );
    await h.store.cancelOAuthTransaction(id);
    expect(h.storage.values.size).toBe(0);
    expect(h.cleanupAttempts).toEqual([]);
    expect([...h.keys]).toEqual(["public-key-1", "unrelated-key"]);
  });

  it.each([
    "direct-state",
    "direct-to-factory",
    "factory-to-direct",
    "factory-reference",
  ])(
    "snapshots all begin fields and the %s discriminant before a deferred read",
    async (shape) => {
      const h = harness();
      const gate = deferGet(h.storage);
      const calls: string[] = [];
      const mutable: Record<string, unknown> = { ...input };
      if (shape.startsWith("factory")) {
        delete mutable.expectedState;
        mutable.createExpectedState = (winningId: string) => {
          calls.push(winningId);
          return "original-state";
        };
      }
      const begun = h.store.beginOAuthTransaction(
        mutable as unknown as BeginOAuthTransactionInput,
      );
      await gate.started;
      expect(calls).toEqual([]);
      Object.assign(mutable, {
        configId: "changed",
        provider: OAuthProviders.X,
        binding: "changed",
        publicKey: "unrelated-key",
        codeVerifier: "changed",
        expectedState: "changed",
      });
      if (shape === "direct-to-factory" || shape === "factory-reference") {
        delete mutable.expectedState;
        mutable.createExpectedState = () => {
          calls.push("wrong-factory");
          return "changed";
        };
      } else delete mutable.createExpectedState;
      gate.release();
      await expect(begun).resolves.toMatchObject({
        ...context,
        publicKey: "public-key-1",
      });
      expect(calls).toEqual(shape.startsWith("factory") ? [id] : []);
      await expect(
        h.store.consumeOAuthTransaction(id, "original-state", context),
      ).resolves.toMatchObject({
        ...context,
        publicKey: "public-key-1",
        codeVerifier: "verifier-secret-1",
      });
    },
  );

  it("keeps snapshotted key ownership when a deferred begin read fails", async () => {
    const h = harness();
    const gate = deferGet(h.storage);
    const deferred = h.storage.get;
    h.storage.get = async (k) => {
      await deferred(k);
      throw new Error("storage-secret");
    };
    h.controls.cleanupFails = true;
    const mutable = { ...input };
    const begun = h.store
      .beginOAuthTransaction(mutable)
      .catch((e: unknown) => e);
    await gate.started;
    Object.assign(mutable, {
      ...context,
      binding: "changed",
      publicKey: "unrelated-key",
    });
    gate.release();
    const failure = await begun;
    expect(failure).toMatchObject({
      message: "OAuth transaction persistence failed",
      cleanupRetryId: `cleanup.${id}`,
    });
    h.controls.cleanupFails = false;
    await h.store.cancelOAuthTransaction(`cleanup.${id}`);
    expect(h.cleanupAttempts).toEqual(["public-key-1", "public-key-1"]);
    expect([...h.keys]).toEqual(["unrelated-key"]);
  });

  it.each(["rightful-to-foreign", "foreign-to-rightful"])(
    "snapshots consume context %s while waiting behind the ID lock",
    async (direction) => {
      const h = harness();
      await h.store.beginOAuthTransaction(input);
      const gate = deferGet(h.storage);
      const blocker = h.store
        .consumeOAuthTransaction(id, input.expectedState, {
          ...context,
          configId: "blocker",
        })
        .catch((e: unknown) => e);
      await gate.started;
      const foreign = {
        configId: "other",
        provider: OAuthProviders.X,
        binding: "changed",
      };
      const mutable = {
        ...(direction === "rightful-to-foreign" ? context : foreign),
      };
      const consuming = h.store.consumeOAuthTransaction(
        id,
        input.expectedState,
        mutable,
      );
      const assertion =
        direction === "rightful-to-foreign"
          ? expect(consuming).resolves.toMatchObject({
              ...context,
              codeVerifier: "verifier-secret-1",
            })
          : expect(consuming).rejects.toThrow("OAuth transaction unavailable");
      Object.assign(
        mutable,
        direction === "rightful-to-foreign" ? foreign : context,
      );
      gate.release();
      await blocker;
      await assertion;
      if (direction === "foreign-to-rightful") {
        await expect(
          h.store.consumeOAuthTransaction(id, input.expectedState, context),
        ).resolves.toMatchObject({ codeVerifier: "verifier-secret-1" });
      }
      expect(h.cleanupAttempts).toEqual([]);
    },
  );
});

describe("OAuth transaction metadata-only selector", () => {
  it("returns only a copy-owned trusted routing tuple, including from reconstructed storage", async () => {
    const h = harness();
    await h.store.beginOAuthTransaction(input);
    const record = JSON.parse(h.storage.values.get(key)!);
    h.storage.values.set(
      key,
      JSON.stringify({
        ...record,
        arbitrary: "secret",
        cleanupRetryId: "secret",
      }),
    );
    const resumed = harness();
    for (const [k, v] of h.storage.values) resumed.storage.values.set(k, v);
    const original = [...resumed.storage.values];
    const selected = await resumed.store.getOAuthTransactionContext(id);
    expect(selected).toEqual(context);
    Object.assign(selected!, {
      configId: "changed",
      provider: OAuthProviders.X,
      binding: "changed",
    });
    await expect(resumed.store.getOAuthTransactionContext(id)).resolves.toEqual(
      context,
    );
    expect([...resumed.storage.values]).toEqual(original);
    expect(resumed.storage.mutations).toEqual([]);
    expect(resumed.cleanupAttempts).toEqual([]);
    await expect(
      resumed.store.consumeOAuthTransaction(id, input.expectedState, context),
    ).resolves.toMatchObject({ codeVerifier: "verifier-secret-1" });
  });

  it.each([
    "absent",
    "malformed",
    "expired",
    "tombstone",
    "intent",
    "contextless-intent",
    "NaN",
    "Infinity",
    "throwing-clock",
  ])(
    "returns null for %s without storage mutation, key cleanup, or secret release",
    async (kind) => {
      const h = harness();
      if (kind !== "absent") await h.store.beginOAuthTransaction(input);
      if (kind === "malformed") h.storage.values.set(key, "not-json");
      if (kind === "expired") h.controls.now = 301_000;
      if (kind === "NaN") h.controls.now = NaN;
      if (kind === "Infinity") h.controls.now = Infinity;
      if (kind === "throwing-clock") h.controls.clockThrows = true;
      if (["tombstone", "intent", "contextless-intent"].includes(kind)) {
        h.controls.cleanupFails = true;
        h.storage.failSet = kind !== "tombstone";
        await expect(h.store.cancelOAuthTransaction(id)).rejects.toThrow(
          "OAuth transaction cleanup failed",
        );
        if (kind === "contextless-intent") h.storage.values.set(key, "{}");
        h.storage.failSet = false;
        h.controls.cleanupFails = false;
      }
      const resumed = kind === "tombstone" ? harness() : h;
      if (resumed !== h)
        for (const [k, v] of h.storage.values) resumed.storage.values.set(k, v);
      resumed.storage.mutations.length = 0;
      resumed.cleanupAttempts.length = 0;
      if (kind.endsWith("intent"))
        resumed.storage.get = async () => {
          throw new Error("intent must be checked first");
        };
      const original = [...resumed.storage.values];
      await expect(
        resumed.store.getOAuthTransactionContext(id),
      ).resolves.toBeNull();
      expect([...resumed.storage.values]).toEqual(original);
      expect(resumed.storage.mutations).toEqual([]);
      expect(resumed.cleanupAttempts).toEqual([]);
      expect([...resumed.keys]).toEqual(["public-key-1", "unrelated-key"]);
    },
  );

  it("shares the ID lock with cancellation and cannot reveal a transaction being invalidated", async () => {
    const h = harness();
    await h.store.beginOAuthTransaction(input);
    const gate = deferGet(h.storage);
    const cancel = h.store.cancelOAuthTransaction(id);
    await gate.started;
    const selection = h.store.getOAuthTransactionContext(id);
    gate.release();
    await cancel;
    await expect(selection).resolves.toBeNull();
  });

  it("rejects malformed IDs before I/O and maps read errors to a fixed persistence error", async () => {
    const h = harness();
    h.storage.get = async () => {
      throw new Error("storage-secret");
    };
    for (const badId of ["../other-key", "", `${id}\n`, `cleanup.${id}`]) {
      await expect(h.store.getOAuthTransactionContext(badId)).rejects.toThrow(
        "OAuth transaction invalid",
      );
    }
    await expect(h.store.getOAuthTransactionContext(id)).rejects.toThrow(
      new Error("OAuth transaction persistence failed"),
    );
    expect(h.storage.mutations).toEqual([]);
    expect(h.cleanupAttempts).toEqual([]);
  });
});
