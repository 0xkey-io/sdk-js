import { describe, expect, it, jest } from "@jest/globals";
import { createCaptchaAttemptGate } from "../utils/captcha-attempt-gate";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

const target = {
  authProxyConfigId: "config-a",
  authProxyUrl: "https://auth-a.example.test",
};

describe("Captcha protected attempt gate", () => {
  it("rejects an unknown target instead of treating it as a signed-off config", async () => {
    let submitted = false;
    const gate = createCaptchaAttemptGate({
      getClientParams: async () => ({}),
      challenge: async () => {
        throw new Error("missing target must not challenge");
      },
    });
    await expect(
      gate.run(async () => {
        submitted = true;
      }),
    ).rejects.toThrow("Captcha target is required");
    expect(submitted).toBe(false);
  });

  it("does not leak a rejected cancellation when a signed-off submission is already running", async () => {
    const submission = deferred<string>();
    const started = deferred<void>();
    const gate = createCaptchaAttemptGate({
      getClientParams: async () => ({}),
      challenge: async () => {
        throw new Error("off must not challenge");
      },
    });
    gate.setTarget(target);
    const run = gate.run(async () => {
      started.resolve(undefined);
      return submission.promise;
    });
    await started.promise;
    gate.cancel();
    submission.resolve("submitted");
    await expect(run).rejects.toThrow("Captcha attempt canceled");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("reads C3 for each protected attempt and preserves the off flow", async () => {
    const selected: string[] = [];
    const gate = createCaptchaAttemptGate({
      getClientParams: async (configId, url) => {
        selected.push(`${url}/${configId}`);
        return {};
      },
      challenge: async () => {
        throw new Error("off must not challenge");
      },
    });
    gate.setTarget(target);

    expect(await gate.run(async (token) => token ?? "off")).toBe("off");
    expect(await gate.run(async (token) => token ?? "off")).toBe("off");
    expect(selected).toEqual([
      "https://auth-a.example.test/config-a",
      "https://auth-a.example.test/config-a",
    ]);
  });

  it("uses one challenge result once and resets after submission failure", async () => {
    const resets: string[] = [];
    let next = 0;
    const gate = createCaptchaAttemptGate({
      getClientParams: async () => ({ turnstileSiteKey: "site-a" }),
      challenge: async (siteKey) => ({
        token: `${siteKey}-token-${++next}`,
        reset: () => resets.push(`${next}`),
      }),
    });
    gate.setTarget(target);

    await expect(gate.run(async (token) => token)).resolves.toBe(
      "site-a-token-1",
    );
    await expect(
      gate.run(async () => {
        throw new Error("submit failed");
      }),
    ).rejects.toThrow("submit failed");
    expect(resets).toEqual(["1", "2"]);
    await expect(gate.run(async (token) => token)).resolves.toBe(
      "site-a-token-3",
    );
  });

  it("never submits the same challenge token twice within its validity window", async () => {
    let submitted = 0;
    const gate = createCaptchaAttemptGate({
      getClientParams: async () => ({ turnstileSiteKey: "site-a" }),
      challenge: async () => ({
        token: "provider-repeated-token",
        reset: () => undefined,
      }),
    });
    gate.setTarget(target);
    const submit = async () => {
      submitted++;
    };
    await gate.run(submit);
    await expect(gate.run(submit)).rejects.toThrow(
      "Captcha token was already used",
    );
    expect(submitted).toBe(1);
  });

  it("resets the widget before the protected activity is submitted", async () => {
    let reset = false;
    const gate = createCaptchaAttemptGate({
      getClientParams: async () => ({ turnstileSiteKey: "site-a" }),
      challenge: async () => ({
        token: "one-use-token",
        reset: () => {
          reset = true;
        },
      }),
    });
    gate.setTarget(target);
    await gate.run(async (token) => {
      expect(reset).toBe(true);
      expect(token).toBe("one-use-token");
    });
  });

  it("fails closed when C3 cannot be read or challenge returns no token", async () => {
    let submitCount = 0;
    const gate = createCaptchaAttemptGate({
      getClientParams: async () => {
        throw new Error("unavailable");
      },
      challenge: async () => ({ token: "", reset: () => undefined }),
    });
    gate.setTarget(target);
    const submit = async () => {
      submitCount++;
    };
    await expect(gate.run(submit)).rejects.toThrow("unavailable");
    expect(submitCount).toBe(0);

    const noToken = createCaptchaAttemptGate({
      getClientParams: async () => ({ turnstileSiteKey: "site-a" }),
      challenge: async () => ({ token: "", reset: () => undefined }),
    });
    noToken.setTarget(target);
    await expect(noToken.run(submit)).rejects.toThrow();
    expect(submitCount).toBe(0);
  });

  it("cancels an old C3 lookup on config switch and only submits the new target", async () => {
    const oldLookup = deferred<{ turnstileSiteKey: string }>();
    const submitted: string[] = [];
    const gate = createCaptchaAttemptGate({
      getClientParams: async (configId) =>
        configId === "config-a"
          ? oldLookup.promise
          : { turnstileSiteKey: "site-b" },
      challenge: async (siteKey) => ({
        token: `${siteKey}-token`,
        reset: () => undefined,
      }),
    });
    gate.setTarget(target);
    const oldRun = gate.run(async (token) => submitted.push(token ?? "off"));
    gate.setTarget({
      authProxyConfigId: "config-b",
      authProxyUrl: "https://auth-b.example.test",
    });
    await expect(oldRun).rejects.toThrow();
    await gate.run(async (token) => submitted.push(token ?? "off"));
    oldLookup.resolve({ turnstileSiteKey: "site-a" });
    await Promise.resolve();
    expect(submitted).toEqual(["site-b-token"]);
  });

  it("rejects a concurrent request and a late result after cancellation", async () => {
    const pending = deferred<{ token: string; reset: () => void }>();
    let submitCount = 0;
    const gate = createCaptchaAttemptGate({
      getClientParams: async () => ({ turnstileSiteKey: "site-a" }),
      challenge: async () => pending.promise,
    });
    gate.setTarget(target);
    const first = gate.run(async () => {
      submitCount++;
    });
    await Promise.resolve();
    await expect(gate.run(async () => undefined)).rejects.toThrow();
    gate.cancel();
    await expect(first).rejects.toThrow();
    pending.resolve({ token: "late-token", reset: () => undefined });
    await Promise.resolve();
    expect(submitCount).toBe(0);
  });

  it("aborts the challenge at the 120-second interaction limit", async () => {
    jest.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const gate = createCaptchaAttemptGate({
        getClientParams: async () => ({ turnstileSiteKey: "site-a" }),
        challenge: async (_siteKey, challengeSignal) => {
          signal = challengeSignal;
          return new Promise(() => undefined);
        },
      });
      gate.setTarget(target);
      const run = gate.run(async () => "submitted");
      const outcome = expect(run).rejects.toThrow();
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(120_000);
      await outcome;
      expect(signal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("fails closed if the C3 capability lookup hangs for 120 seconds", async () => {
    jest.useFakeTimers();
    try {
      let submitted = false;
      const gate = createCaptchaAttemptGate({
        getClientParams: async () => new Promise(() => undefined),
        challenge: async () => ({ token: "never", reset: () => undefined }),
      });
      gate.setTarget(target);
      const outcome = expect(
        gate.run(async () => {
          submitted = true;
        }),
      ).rejects.toThrow();
      await jest.advanceTimersByTimeAsync(120_000);
      await outcome;
      expect(submitted).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
