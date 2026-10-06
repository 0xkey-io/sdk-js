import { jest } from "@jest/globals";
import { WebAtomicBoundSessionStore } from "../../__storage__/web/bound-session";

/** Provides an explicit atomic adapter for Core tests unrelated to browser IDB. */
export function installBoundWebStore(): void {
  if (jest.isMockFunction(WebAtomicBoundSessionStore.prototype.read)) return;
  const records = new Map<string, unknown>();
  let tail = Promise.resolve();
  jest
    .spyOn(WebAtomicBoundSessionStore.prototype, "read")
    .mockImplementation(async (key) => records.get(key));
  jest
    .spyOn(WebAtomicBoundSessionStore.prototype, "transact")
    .mockImplementation(async (key, update, signal) => {
      const work = tail.then(() => {
        if (signal.aborted) throw new Error("Bound transaction aborted");
        const next = update(records.get(key));
        if (signal.aborted) throw new Error("Bound transaction aborted");
        if (next === undefined) records.delete(key);
        else records.set(key, next);
        return next;
      });
      tail = work.then(
        () => undefined,
        () => undefined,
      );
      return work;
    });
}
