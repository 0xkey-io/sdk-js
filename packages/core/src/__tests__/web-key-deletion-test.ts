import { beforeEach, describe, expect, it } from "@jest/globals";
import { IndexedDbStamper } from "../__stampers__/api/web/stamper";

describe("IndexedDbStamper key deletion", () => {
  beforeEach(() => {
    (global as any).window = {};
  });

  it("rejects when the deletion transaction aborts", async () => {
    const abortError = new Error("transaction aborted");
    const transaction = {
      error: abortError,
      objectStore: () => ({ delete: () => undefined }),
      onabort: null as null | (() => void),
      oncomplete: null as null | (() => void),
      onerror: null as null | (() => void),
    };
    const db = {
      close: () => undefined,
      transaction: () => {
        queueMicrotask(() => transaction.onabort?.());
        return transaction;
      },
    };
    (global as any).indexedDB = {
      open: () => {
        const request = {
          result: db,
          error: null,
          onerror: null as null | (() => void),
          onsuccess: null as null | (() => void),
          onupgradeneeded: null as null | (() => void),
        };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    };

    const deletion = new IndexedDbStamper().deleteKeyPair("public-key");

    const outcome = await Promise.race([
      deletion.then(
        () => ({ status: "resolved" as const }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      ),
      new Promise<{ status: "timed-out" }>((resolve) =>
        setTimeout(() => resolve({ status: "timed-out" }), 20),
      ),
    ]);

    expect(outcome).toEqual({ status: "rejected", error: abortError });
  });
});
