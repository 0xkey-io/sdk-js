import { describe, expect, it, jest } from "@jest/globals";
import { attachOAuthLinking } from "../utils/oauth-linking";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function source(initial: Promise<string | null>) {
  let listener: ((event: { url: string }) => void) | undefined;
  const remove = jest.fn();
  const linking = {
    getInitialURL: jest.fn(() => initial),
    addEventListener: jest.fn(
      (_type: "url", next: (event: { url: string }) => void) => {
        listener = next;
        return { remove };
      },
    ),
  };
  return { linking, emit: (url: string) => listener?.({ url }), remove };
}

describe("attachOAuthLinking", () => {
  it("subscribes before the initial URL resolves and drains unique URLs in arrival order", async () => {
    const initial = deferred<string | null>();
    const harness = source(initial.promise);
    const calls: string[] = [];
    const attachment = attachOAuthLinking({
      linking: harness.linking,
      dispatch: async (url) => {
        calls.push(url);
        return "completed";
      },
      onError: jest.fn(),
    });

    expect(harness.linking.addEventListener).toHaveBeenCalledTimes(1);
    harness.emit("example://?state=event");
    harness.emit("example://?state=event");
    initial.resolve("example://?state=initial");
    await Promise.resolve();
    expect(calls).toEqual([]);

    attachment.setReady(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([
      "example://?state=event",
      "example://?state=initial",
    ]);
  });

  it("pauses draining, reports fixed errors once, and ignores unrelated results", async () => {
    const harness = source(Promise.resolve(null));
    const errors: Error[] = [];
    const second = deferred<"completed" | "ignored">();
    const dispatch = jest
      .fn<(url: string) => Promise<"completed" | "ignored">>()
      .mockResolvedValueOnce("ignored")
      .mockImplementationOnce(() => second.promise)
      .mockRejectedValueOnce(new Error("secret callback URL"));
    const attachment = attachOAuthLinking({
      linking: harness.linking,
      dispatch,
      onError: (error) => errors.push(error),
    });
    attachment.setReady(true);
    harness.emit("other://unrelated");
    harness.emit("example://second");
    harness.emit("example://third");
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(2);
    attachment.setReady(false);
    second.resolve("completed");
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(2);

    attachment.setReady(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("OAuth callback handling failed");
  });

  it("disposes idempotently, drops queued URLs, and ignores a late initial URL", async () => {
    const initial = deferred<string | null>();
    const harness = source(initial.promise);
    const dispatch = jest.fn(async () => "completed" as const);
    const attachment = attachOAuthLinking({
      linking: harness.linking,
      dispatch,
      onError: jest.fn(),
    });
    harness.emit("example://queued");
    attachment.dispose();
    attachment.dispose();
    initial.resolve("example://late");
    attachment.setReady(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.remove).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("reports an initial URL rejection without leaking its cause", async () => {
    const harness = source(Promise.reject(new Error("native secret")));
    const onError = jest.fn();
    attachOAuthLinking({
      linking: harness.linking,
      dispatch: async () => "ignored",
      onError,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toEqual(
      new Error("OAuth callback source failed"),
    );
  });

  it("contains a throwing reporter for initial and dispatch failures and continues draining", async () => {
    const harness = source(Promise.reject(new Error("native secret")));
    const delivered: string[] = [];
    const dispatch = jest
      .fn<(url: string) => Promise<"completed" | "ignored">>()
      .mockRejectedValueOnce(new Error("callback secret"))
      .mockImplementationOnce(async (url) => {
        delivered.push(url);
        return "completed";
      });
    const attachment = attachOAuthLinking({
      linking: harness.linking,
      dispatch,
      onError: () => {
        throw new Error("customer reporter failure");
      },
    });
    attachment.setReady(true);
    harness.emit("example://first");
    harness.emit("example://second");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(delivered).toEqual(["example://second"]);
  });

  it("observes an ordinary rejected Promise returned by the reporter", async () => {
    const harness = source(Promise.reject(new Error("native secret")));
    const dispatch = jest
      .fn<(url: string) => Promise<"completed" | "ignored">>()
      .mockRejectedValueOnce(new Error("dispatch secret"))
      .mockResolvedValueOnce("completed");
    const onError = jest.fn(() =>
      Promise.reject(new Error("async reporter failure")),
    );
    const attachment = attachOAuthLinking({
      linking: harness.linking,
      dispatch,
      onError: onError as unknown as (error: Error) => void,
    });
    attachment.setReady(true);
    harness.emit("example://first");
    harness.emit("example://second");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
