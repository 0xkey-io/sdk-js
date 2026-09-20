import { describe, expect, it, jest } from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import {
  createOAuthTransactionStore,
  type BeginOAuthTransactionInput,
} from "../utils/oauth-transaction";

// The actual fallback loaded by React Native 0.76.5's Libraries/Promise.js.
const PolyfillPromise =
  require("promise/setimmediate/es6-extensions") as PromiseConstructor;
const rejectionTracking =
  require("promise/setimmediate/rejection-tracking") as {
    enable(options: {
      allRejections: boolean;
      onUnhandled(id: number, error: unknown): void;
    }): void;
    disable(): void;
  };
const NativePromise = globalThis.Promise;

function makeStore() {
  const values = new Map<string, string>([["unrelated", "preserved"]]);
  const mutations: string[] = [];
  const store = createOAuthTransactionStore({
    secureStorage: {
      async get(key) {
        return values.get(key) ?? null;
      },
      async set(key, value) {
        mutations.push("set");
        values.set(key, value);
      },
      async remove(key) {
        mutations.push("remove");
        values.delete(key);
      },
    },
    randomBytes: () => Uint8Array.from(new Array(16).fill(1)),
    now: () => 1_000_000,
    cleanupTemporaryKey: async () => void mutations.push("cleanup"),
  });
  return { store, values, mutations };
}

const input = {
  configId: "config-1",
  provider: OAuthProviders.GOOGLE,
  binding: "routing-1",
  publicKey: "public-key-1",
  codeVerifier: "verifier-secret-1",
};

function expectInvalid(failure: unknown) {
  expect(failure).toMatchObject({ message: "OAuth transaction invalid" });
  expect(failure).not.toHaveProperty("transactionId");
  expect(failure).not.toHaveProperty("cleanupRetryId");
  expect(String(failure)).not.toContain("factory-secret");
}

describe.each<[string, PromiseConstructor]>([
  ["native", NativePromise],
  ["React Native promise@8.3.0 fallback", PolyfillPromise],
])("OAuth factory result under %s", (_runtime, RuntimePromise) => {
  it.each([
    "constructor getter",
    "constructor function",
    "then getter",
    "then method",
  ])("rejects an invalid object without executing its %s", async (shape) => {
    let calls = 0;
    const hook = function () {
      calls++;
      throw new Error("factory-secret");
    };
    const invalid = {};
    Object.defineProperty(
      invalid,
      shape.startsWith("constructor") ? "constructor" : "then",
      shape.endsWith("getter") ? { get: hook } : { value: hook },
    );
    const { store, values, mutations } = makeStore();
    const previousPromise = globalThis.Promise;
    try {
      globalThis.Promise = RuntimePromise;
      const failure = await store
        .beginOAuthTransaction({
          ...input,
          createExpectedState: () => invalid,
        } as unknown as BeginOAuthTransactionInput)
        .catch((error: unknown) => error);
      expectInvalid(failure);
      expect(calls).toBe(0);
      expect(mutations).toEqual([]);
      expect([...values]).toEqual([["unrelated", "preserved"]]);
    } finally {
      globalThis.Promise = previousPromise;
    }
  });

  it.each(["immediate", "later"])(
    "rejects immediately and observes a Promise rejected %s without ownership",
    async (timing) => {
      const { store, values, mutations } = makeStore();
      const unhandled: unknown[] = [];
      let rejectLater: ((error: Error) => void) | undefined;
      const previousPromise = globalThis.Promise;
      jest.useFakeTimers({
        doNotFake: ["setImmediate", "nextTick", "queueMicrotask"],
      });
      rejectionTracking.enable({
        allRejections: true,
        onUnhandled: (_id, error) => unhandled.push(error),
      });
      try {
        globalThis.Promise = RuntimePromise;
        const failure = await store
          .beginOAuthTransaction({
            ...input,
            createExpectedState: () =>
              timing === "immediate"
                ? RuntimePromise.reject(new Error("factory-secret"))
                : new RuntimePromise<string>((_resolve, reject) => {
                    rejectLater = reject;
                  }),
          } as unknown as BeginOAuthTransactionInput)
          .catch((error: unknown) => error);
        // A pending factory Promise must not delay begin's sanitized rejection.
        expectInvalid(failure);
        rejectLater?.(new Error("factory-secret"));
        await new NativePromise<void>((resolve) => setImmediate(resolve));
        // Exercise the actual polyfill's 2-second unhandled-rejection tracker.
        jest.advanceTimersByTime(2001);
        expect(unhandled).toEqual([]);
        expect(mutations).toEqual([]);
        expect([...values]).toEqual([["unrelated", "preserved"]]);
      } finally {
        globalThis.Promise = previousPromise;
        rejectionTracking.disable();
        jest.useRealTimers();
      }
    },
  );

  it("discards a fulfilled Promise without accepting state or ownership", async () => {
    const { store, values, mutations } = makeStore();
    const previousPromise = globalThis.Promise;
    try {
      globalThis.Promise = RuntimePromise;
      const failure = await store
        .beginOAuthTransaction({
          ...input,
          createExpectedState: () => RuntimePromise.resolve("factory-secret"),
        } as unknown as BeginOAuthTransactionInput)
        .catch((error: unknown) => error);
      expectInvalid(failure);
      await new NativePromise<void>((resolve) => setImmediate(resolve));
      expect(mutations).toEqual([]);
      expect([...values]).toEqual([["unrelated", "preserved"]]);
    } finally {
      globalThis.Promise = previousPromise;
    }
  });
});
