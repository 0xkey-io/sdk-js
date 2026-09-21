/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://app.example.test/"}
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import { TextEncoder as NodeTextEncoder } from "node:util";
import {
  runOAuthPopup,
  type OAuthPopupDependencies,
  type OAuthPopupInput,
} from "../utils/oauth/popup-flow";
import { inspectOAuthPopupResponse } from "../utils/oauth/popup-response";
import { installOAuthPopups } from "./fixtures/oauth-popup";

const origin = "https://app.example.test";
const callbackPath = `${origin}/oauth/callback`;

function standardResponse(input: {
  provider: OAuthProviders;
  state?: string;
  code?: string;
  token?: string;
  fragmentCode?: string;
}): string {
  if (
    input.provider === OAuthProviders.FACEBOOK ||
    input.provider === OAuthProviders.X ||
    input.provider === OAuthProviders.DISCORD
  ) {
    const query = new URLSearchParams();
    if (input.code !== undefined) query.append("code", input.code);
    if (input.state !== undefined) query.append("state", input.state);
    return `${callbackPath}?${query.toString()}`;
  }
  const fragment = new URLSearchParams();
  if (input.token !== undefined) fragment.append("id_token", input.token);
  if (input.state !== undefined) fragment.append("state", input.state);
  if (input.fragmentCode !== undefined) {
    fragment.append("code", input.fragmentCode);
  }
  return `${callbackPath}#${fragment.toString()}`;
}

function inspect(
  url: string,
  expectedProvider: OAuthProviders,
  expectedState: string,
) {
  return inspectOAuthPopupResponse({
    url,
    expectedProvider,
    expectedState,
    openerOrigin: origin,
  });
}

describe("strict OAuth popup response admission", () => {
  const expectedState =
    "provider=discord&flow=popup&publicKey=pk%2Fone&nonce=nonce&transactionId=00112233445566778899aabbccddeeff";

  it("keeps provider and same-origin intermediate pages pending", () => {
    expect(
      inspect(
        "https://discord.com/oauth2/authorize?client_id=client",
        OAuthProviders.DISCORD,
        expectedState,
      ),
    ).toEqual({ kind: "pending" });
    expect(
      inspect(
        `${callbackPath}?loading=true`,
        OAuthProviders.DISCORD,
        expectedState,
      ),
    ).toEqual({ kind: "pending" });
  });

  it("accepts one same-origin PKCE code only with the exact raw state", () => {
    expect(
      inspect(
        standardResponse({
          provider: OAuthProviders.DISCORD,
          code: "code-discord",
          state: expectedState,
        }),
        OAuthProviders.DISCORD,
        expectedState,
      ),
    ).toEqual({ kind: "accepted", authCode: "code-discord" });
  });

  it.each([
    OAuthProviders.GOOGLE,
    OAuthProviders.APPLE,
    OAuthProviders.FACEBOOK,
    OAuthProviders.X,
    OAuthProviders.DISCORD,
  ])("rejects %s responses with another operation's state", (provider) => {
    const url = standardResponse({
      provider,
      state: `${expectedState}-other`,
      ...(provider === OAuthProviders.GOOGLE ||
      provider === OAuthProviders.APPLE
        ? { token: "token" }
        : { code: "code" }),
    });
    expect(inspect(url, provider, expectedState)).toEqual({ kind: "rejected" });
  });

  it.each([
    ["provider mutation", expectedState.replace("discord", "x")],
    ["flow mutation", expectedState.replace("popup", "redirect")],
    ["key mutation", expectedState.replace("pk%2Fone", "attacker")],
    ["decoded-equivalent rewrite", expectedState.replace("%2F", "%2f")],
  ])("rejects %s instead of reparsing authority", (_label, returnedState) => {
    expect(
      inspect(
        standardResponse({
          provider: OAuthProviders.DISCORD,
          code: "code",
          state: returnedState,
        }),
        OAuthProviders.DISCORD,
        expectedState,
      ),
    ).toEqual({ kind: "rejected" });
  });

  it.each([
    [
      "duplicate state",
      `${callbackPath}?code=code&state=${encodeURIComponent(expectedState)}&state=${encodeURIComponent(expectedState)}`,
    ],
    ["malformed escape", `${callbackPath}?code=code&state=%E0%A4%A`],
    [
      "mixed response channels",
      `${callbackPath}?code=code&state=${encodeURIComponent(expectedState)}#id_token=token`,
    ],
    [
      "provider error",
      `${callbackPath}?error=access_denied&state=${encodeURIComponent(expectedState)}`,
    ],
    [
      "empty code",
      `${callbackPath}?code=&state=${encodeURIComponent(expectedState)}`,
    ],
    ["missing state", `${callbackPath}?code=code`],
    [
      "readable wrong origin",
      `https://app.example.test.evil.invalid/oauth/callback?code=code&state=${encodeURIComponent(expectedState)}`,
    ],
  ])("rejects $0", (_label, url) => {
    expect(inspect(url, OAuthProviders.DISCORD, expectedState)).toEqual({
      kind: "rejected",
    });
  });

  it("accepts standard Apple token-only and hybrid responses", () => {
    const appleState = expectedState.replace("discord", "apple");
    expect(
      inspect(
        standardResponse({
          provider: OAuthProviders.APPLE,
          token: "apple-token",
          state: appleState,
        }),
        OAuthProviders.APPLE,
        appleState,
      ),
    ).toEqual({ kind: "accepted", oidcToken: "apple-token" });
    expect(
      inspect(
        standardResponse({
          provider: OAuthProviders.APPLE,
          token: "apple-token",
          fragmentCode: "apple-code",
          state: appleState,
        }),
        OAuthProviders.APPLE,
        appleState,
      ),
    ).toEqual({ kind: "accepted", oidcToken: "apple-token" });
  });

  it("accepts only the exact Apple raw-hash state bytes", () => {
    const appleState = expectedState.replace("discord", "apple");
    const raw = `${callbackPath}#state=${appleState}&code=apple-code&id_token=apple-token`;
    expect(inspect(raw, OAuthProviders.APPLE, appleState)).toEqual({
      kind: "accepted",
      oidcToken: "apple-token",
    });
    expect(
      inspect(raw, OAuthProviders.APPLE, appleState.replace("%2F", "%2f")),
    ).toEqual({ kind: "rejected" });
  });

  it.each([
    `${callbackPath}#id_token=&state=state`,
    `${callbackPath}#id_token=token&state=state&state=state`,
    `${callbackPath}#id_token=token&state=state&code=one&code=two`,
    `${callbackPath}#error=access_denied&state=state`,
    `${callbackPath}?code=query#id_token=token&state=state`,
  ])("rejects ambiguous or invalid Apple response %s", (url) => {
    expect(inspect(url, OAuthProviders.APPLE, "state")).toEqual({
      kind: "rejected",
    });
  });
});

type FlowOutcome =
  | { status: "pending" }
  | { status: "fulfilled" }
  | { status: "rejected"; reason: unknown };

function observeFlow(promise: Promise<void>) {
  let outcome: FlowOutcome = { status: "pending" };
  const settled = promise.then(
    () => {
      outcome = { status: "fulfilled" };
    },
    (reason: unknown) => {
      outcome = { status: "rejected", reason };
    },
  );
  return { outcome: () => outcome, settled };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("live OAuth popup lifecycle", () => {
  let textEncoderDescriptor: PropertyDescriptor | undefined;
  let popups: ReturnType<typeof installOAuthPopups>;
  let now: number;
  let order: string[];
  let discarded: string[];
  let exchanges: Array<{
    authCode: string;
    codeVerifier: string;
    publicKey: string;
    nonce: string;
  }>;
  let completions: Array<{
    provider: OAuthProviders;
    publicKey: string;
    oidcToken: string;
    sessionKey?: string;
  }>;
  let dependencies: OAuthPopupDependencies;
  let input: OAuthPopupInput;

  beforeEach(() => {
    textEncoderDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "TextEncoder",
    );
    Object.defineProperty(globalThis, "TextEncoder", {
      configurable: true,
      value: NodeTextEncoder,
    });
    jest.useFakeTimers({ now: 0 });
    popups = installOAuthPopups();
    now = 0;
    order = [];
    discarded = [];
    exchanges = [];
    completions = [];
    dependencies = {
      randomBytes(length) {
        order.push("random");
        return Uint8Array.from({ length }, (_, index) => index);
      },
      async generatePkce() {
        order.push("pkce");
        return {
          verifier: "verifier-A",
          codeChallenge: "challenge-A",
        };
      },
      async createApiKeyPair() {
        order.push("key");
        return "public-A";
      },
      async discardUncommittedApiKeyPair(publicKey) {
        discarded.push(publicKey);
      },
      now: () => now,
      openPopup() {
        order.push("open");
        return window.open();
      },
    };
    input = {
      provider: OAuthProviders.DISCORD,
      clientId: "client-A",
      redirectUri: `${origin}/oauth/callback`,
      additionalState: { sessionKey: "session-A" },
      async exchange(exchangeInput) {
        exchanges.push(exchangeInput);
        return "token-A";
      },
      async complete(completionInput) {
        completions.push(completionInput);
      },
    };
  });

  afterEach(() => {
    for (const popup of popups.handles) popup.close();
    popups.open.mockRestore();
    if (textEncoderDescriptor) {
      Object.defineProperty(globalThis, "TextEncoder", textEncoderDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "TextEncoder");
    }
    jest.useRealTimers();
  });

  async function start() {
    const previousHandleCount = popups.handles.length;
    const observed = observeFlow(runOAuthPopup(input, dependencies));
    for (
      let index = 0;
      index < 20 && popups.handles.length === previousHandleCount;
      index += 1
    ) {
      await Promise.resolve();
    }
    return { observed, popup: popups.handles[popups.handles.length - 1] };
  }

  async function tick(milliseconds = 500) {
    await jest.advanceTimersByTimeAsync(milliseconds);
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  }

  function assigned() {
    return new URL(popups.handles[0]!.assignedUrls[0]!);
  }

  function deliverDiscord(
    code = "code-A",
    state = assigned().searchParams.get("state")!,
  ) {
    popups.handles[0]!.deliver(
      `${origin}/oauth/callback?${new URLSearchParams({ code, state })}`,
    );
  }

  it("prepares unpredictable state before key allocation and completes once", async () => {
    const { observed, popup } = await start();
    const authorizationUrl = assigned();
    const state = new URLSearchParams(
      authorizationUrl.searchParams.get("state")!,
    );
    expect(order).toEqual(["random", "pkce", "key", "open"]);
    expect(state.get("transactionId")).toBe("000102030405060708090a0b0c0d0e0f");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe(
      "challenge-A",
    );

    deliverDiscord();
    await tick();
    await observed.settled;

    expect(exchanges).toEqual([
      {
        authCode: "code-A",
        codeVerifier: "verifier-A",
        publicKey: "public-A",
        nonce: expect.any(String),
      },
    ]);
    expect(completions).toEqual([
      {
        provider: OAuthProviders.DISCORD,
        publicKey: "public-A",
        oidcToken: "token-A",
        sessionKey: "session-A",
      },
    ]);
    expect(discarded).toEqual([]);
    expect(popup!.close).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    "transactionId",
    "provider",
    "flow",
    "publicKey",
    "nonce",
    "state",
    "code",
    "id_token",
    "error",
    "error_description",
    "error_uri",
  ])(
    "rejects reserved additional state %s before creating secrets",
    async (field) => {
      input.additionalState = { [field]: "attacker" };
      const observed = observeFlow(runOAuthPopup(input, dependencies));
      await observed.settled;
      expect(observed.outcome()).toEqual({
        status: "rejected",
        reason: expect.any(Error),
      });
      expect(order).toEqual([]);
    },
  );

  it("fails closed when randomness is short and does not allocate a key", async () => {
    dependencies.randomBytes = () => new Uint8Array(15);
    const observed = observeFlow(runOAuthPopup(input, dependencies));
    await observed.settled;
    expect(observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.any(Error),
    });
    expect(order).toEqual([]);
    expect(discarded).toEqual([]);
  });

  it("rejects non-string additional state before randomness or key allocation", async () => {
    input.additionalState = { sessionKey: 42 } as unknown as Record<
      string,
      string
    >;
    const observed = observeFlow(runOAuthPopup(input, dependencies));
    await observed.settled;
    expect(observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.any(Error),
    });
    expect(order).toEqual([]);
  });

  it("rejects PKCE preparation failure before key allocation", async () => {
    const failure = new Error("synthetic PKCE failure");
    dependencies.generatePkce = async () => {
      throw failure;
    };
    const observed = observeFlow(runOAuthPopup(input, dependencies));
    await observed.settled;
    expect(observed.outcome()).toEqual({
      status: "rejected",
      reason: failure,
    });
    expect(order).toEqual(["random"]);
    expect(discarded).toEqual([]);
  });

  it("disposes the fresh key when preparation fails after allocation", async () => {
    const failure = new Error("synthetic clock failure");
    dependencies.now = () => {
      throw failure;
    };
    const observed = observeFlow(runOAuthPopup(input, dependencies));
    await observed.settled;
    expect(observed.outcome()).toEqual({
      status: "rejected",
      reason: failure,
    });
    expect(discarded).toEqual(["public-A"]);
  });

  it("does not create PKCE material for a non-PKCE provider", async () => {
    input = {
      ...input,
      provider: OAuthProviders.GOOGLE,
      exchange: undefined,
    };
    dependencies.generatePkce = async () => {
      throw new Error("Google must not create PKCE material");
    };
    const { observed, popup } = await start();
    const authorizationUrl = new URL(popup!.assignedUrls[0]!);
    popup!.deliver(
      `${origin}/oauth/callback#${new URLSearchParams({
        id_token: "google-token",
        state: authorizationUrl.searchParams.get("state")!,
      })}`,
    );
    await tick();
    await observed.settled;
    expect(observed.outcome()).toEqual({ status: "fulfilled" });
    expect(order).toEqual(["random", "key", "open"]);
  });

  it.each([
    {
      provider: OAuthProviders.X,
      delivery: ["A", "B"] as const,
      order: "A-then-B",
    },
    {
      provider: OAuthProviders.X,
      delivery: ["B", "A"] as const,
      order: "B-then-A",
    },
    {
      provider: OAuthProviders.FACEBOOK,
      delivery: ["A", "B"] as const,
      order: "A-then-B",
    },
    {
      provider: OAuthProviders.FACEBOOK,
      delivery: ["B", "A"] as const,
      order: "B-then-A",
    },
  ])(
    "isolates concurrent $provider PKCE verifiers in $order order",
    async ({ provider, delivery }) => {
      const exchangeCalls: Array<{
        owner: string;
        authCode: string;
        codeVerifier: string;
      }> = [];
      const completionCalls: Array<{ owner: string; publicKey: string }> = [];
      const operations = (["A", "B"] as const).map((owner, ownerIndex) => {
        const operationInput: OAuthPopupInput = {
          provider,
          clientId: `client-${owner}`,
          redirectUri: `${origin}/oauth/callback`,
          async exchange({ authCode, codeVerifier }) {
            exchangeCalls.push({ owner, authCode, codeVerifier });
            return `token-${owner}`;
          },
          async complete({ publicKey }) {
            completionCalls.push({ owner, publicKey });
          },
        };
        const operationDependencies: OAuthPopupDependencies = {
          randomBytes: (length) =>
            Uint8Array.from({ length }, (_, index) => index + ownerIndex),
          async generatePkce() {
            return {
              verifier: `verifier-${owner}`,
              codeChallenge: `challenge-${owner}`,
            };
          },
          async createApiKeyPair() {
            return `public-${owner}`;
          },
          async discardUncommittedApiKeyPair(publicKey) {
            throw new Error(`Unexpected discard of ${publicKey}`);
          },
          now: () => now,
          openPopup: () => window.open(),
        };
        return {
          owner,
          observed: observeFlow(
            runOAuthPopup(operationInput, operationDependencies),
          ),
        };
      });

      for (
        let index = 0;
        index < 20 &&
        (popups.handles.length !== 2 ||
          popups.handles.some((popup) => popup.assignedUrls.length !== 1));
        index += 1
      ) {
        await Promise.resolve();
      }
      const records = operations.map((operation, index) => ({
        ...operation,
        popup: popups.handles[index]!,
        authorizationUrl: new URL(popups.handles[index]!.assignedUrls[0]!),
      }));
      expect(
        records.map((record) =>
          record.authorizationUrl.searchParams.get("code_challenge"),
        ),
      ).toEqual(["challenge-A", "challenge-B"]);

      for (const owner of delivery) {
        const record = records[owner === "A" ? 0 : 1]!;
        record.popup.deliver(
          standardResponse({
            provider,
            code: `code-${record.owner}`,
            state: record.authorizationUrl.searchParams.get("state")!,
          }),
        );
        await tick();
      }
      await Promise.all(records.map((record) => record.observed.settled));

      expect(exchangeCalls).toEqual(
        delivery.map((owner) => ({
          owner,
          authCode: `code-${owner}`,
          codeVerifier: `verifier-${owner}`,
        })),
      );
      expect(completionCalls).toEqual(
        delivery.map((owner) => ({
          owner,
          publicKey: `public-${owner}`,
        })),
      );
      expect(records.map((record) => record.observed.outcome())).toEqual([
        { status: "fulfilled" },
        { status: "fulfilled" },
      ]);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it.each([
    "blocked",
    "already closed",
    "assignment failure",
    "ordinary close",
  ])(
    "disposes only its synthetic local key when the popup is %s",
    async (failure) => {
      if (failure === "blocked") popups.open.mockImplementationOnce(() => null);
      if (failure === "already closed") popups.setNextClosed();
      if (failure === "assignment failure") popups.failNextAssignment();
      const { observed, popup } = await start();
      if (failure === "ordinary close") {
        popup!.setClosed();
        await tick();
      }
      await observed.settled;
      expect(observed.outcome()).toEqual({
        status: "rejected",
        reason: expect.any(Error),
      });
      expect(discarded).toEqual(["public-A"]);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it("treats a cross-origin location read as pending, then admits a valid response", async () => {
    const { observed, popup } = await start();
    popup!.failNextRead();
    await tick();
    expect(observed.outcome()).toEqual({ status: "pending" });
    expect(exchanges).toEqual([]);

    deliverDiscord();
    await tick();
    await observed.settled;
    expect(observed.outcome()).toEqual({ status: "fulfilled" });
    expect(exchanges).toHaveLength(1);
    expect(discarded).toEqual([]);
  });

  it("admits at 299999ms and rejects at the 300000ms boundary", async () => {
    let started = await start();
    now = 299_999;
    deliverDiscord();
    await tick();
    await started.observed.settled;
    expect(started.observed.outcome()).toEqual({ status: "fulfilled" });
    expect(discarded).toEqual([]);

    input = { ...input, additionalState: undefined };
    dependencies = {
      ...dependencies,
      createApiKeyPair: async () => "public-B",
    };
    now = 1_000_000;
    started = await start();
    const secondPopup = popups.handles[1]!;
    const secondUrl = new URL(secondPopup.assignedUrls[0]!);
    now = 1_300_000;
    secondPopup.deliver(
      `${origin}/oauth/callback?${new URLSearchParams({
        code: "code-B",
        state: secondUrl.searchParams.get("state")!,
      })}`,
    );
    await tick();
    await started.observed.settled;
    expect(started.observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.any(Error),
    });
    expect(exchanges).toHaveLength(1);
    expect(discarded).toEqual(["public-B"]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("claims a response before awaiting exchange and ignores duplicate delivery", async () => {
    const exchange = deferred<string>();
    input.exchange = async (exchangeInput) => {
      exchanges.push(exchangeInput);
      return exchange.promise;
    };
    const { observed, popup } = await start();
    deliverDiscord("code-first");
    await tick();
    popup!.deliver(
      `${origin}/oauth/callback?${new URLSearchParams({
        code: "code-second",
        state: assigned().searchParams.get("state")!,
      })}`,
    );
    popup!.setClosed();
    now = 400_000;
    await tick(300_000);
    expect(exchanges).toHaveLength(1);
    expect(completions).toHaveLength(0);
    expect(discarded).toEqual([]);

    exchange.resolve("token-first");
    await observed.settled;
    expect(observed.outcome()).toEqual({ status: "fulfilled" });
    expect(completions).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("disposes before handoff when exchange rejects", async () => {
    const exchangeError = new Error("synthetic exchange failure");
    input.exchange = async () => {
      throw exchangeError;
    };
    const { observed } = await start();
    deliverDiscord();
    await tick();
    await observed.settled;
    expect(observed.outcome()).toEqual({
      status: "rejected",
      reason: exchangeError,
    });
    expect(completions).toEqual([]);
    expect(discarded).toEqual(["public-A"]);
  });

  it("preserves the original flow failure when exact disposal fails", async () => {
    const exchangeError = new Error("synthetic exchange failure");
    input.exchange = async () => {
      throw exchangeError;
    };
    dependencies.discardUncommittedApiKeyPair = async () => {
      throw new Error("secret-bearing cleanup failure");
    };
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { observed } = await start();
      deliverDiscord();
      await tick();
      await observed.settled;
      expect(observed.outcome()).toEqual({
        status: "rejected",
        reason: exchangeError,
      });
      expect(warning).toHaveBeenCalledWith("OAuth popup cleanup failed", {
        error: "discard-failed",
        stage: "exchange",
      });
    } finally {
      warning.mockRestore();
    }
  });

  it("never disposes after handoff when completion rejects after the deadline", async () => {
    const completion = deferred<void>();
    input.complete = async (completionInput) => {
      completions.push(completionInput);
      return completion.promise;
    };
    const { observed, popup } = await start();
    deliverDiscord();
    await tick();
    expect(completions).toHaveLength(1);
    popup!.setClosed();
    now = 500_000;
    await tick(500_000);
    expect(observed.outcome()).toEqual({ status: "pending" });
    expect(discarded).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);

    const completionError = new Error("synthetic completion failure");
    completion.reject(completionError);
    await observed.settled;
    expect(observed.outcome()).toEqual({
      status: "rejected",
      reason: completionError,
    });
    expect(discarded).toEqual([]);
  });

  it("snapshots provider configuration and exchange capability before its first await", async () => {
    const preparation = deferred<{
      verifier: string;
      codeChallenge: string;
    }>();
    dependencies.generatePkce = () => preparation.promise;
    const originalExchange = jest.fn(async () => "original-token");
    const replacementExchange = jest.fn(async () => "replacement-token");
    input.exchange = originalExchange;

    const started = start();
    input.provider = OAuthProviders.GOOGLE;
    input.clientId = "mutated-client";
    input.redirectUri = `${origin}/mutated-callback`;
    input.exchange = replacementExchange;
    preparation.resolve({
      verifier: "original-verifier",
      codeChallenge: "original-challenge",
    });
    const { observed, popup } = await started;
    const authorizationUrl = new URL(popup!.assignedUrls[0]!);

    expect(authorizationUrl.origin).toBe("https://discord.com");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("client-A");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      `${origin}/oauth/callback`,
    );
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe(
      "original-challenge",
    );

    popup!.deliver(
      standardResponse({
        provider: OAuthProviders.DISCORD,
        code: "snapshot-code",
        state: authorizationUrl.searchParams.get("state")!,
      }),
    );
    await tick();
    await observed.settled;

    expect(originalExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        authCode: "snapshot-code",
        codeVerifier: "original-verifier",
      }),
    );
    expect(replacementExchange).not.toHaveBeenCalled();
    expect(completions).toEqual([
      expect.objectContaining({
        provider: OAuthProviders.DISCORD,
        oidcToken: "original-token",
      }),
    ]);
  });

  it("snapshots exact discard capability before its first await", async () => {
    const preparation = deferred<{
      verifier: string;
      codeChallenge: string;
    }>();
    dependencies.generatePkce = () => preparation.promise;
    const originalDiscard = jest.fn(async () => undefined);
    const replacementDiscard = jest.fn(async () => undefined);
    dependencies.discardUncommittedApiKeyPair = originalDiscard;

    const started = start();
    dependencies.discardUncommittedApiKeyPair = replacementDiscard;
    preparation.resolve({
      verifier: "discard-verifier",
      codeChallenge: "discard-challenge",
    });
    const { observed, popup } = await started;
    const authorizationUrl = new URL(popup!.assignedUrls[0]!);
    popup!.deliver(
      standardResponse({
        provider: OAuthProviders.DISCORD,
        code: "discard-code",
        state: `${authorizationUrl.searchParams.get("state")!}-wrong`,
      }),
    );
    await tick();
    await observed.settled;

    expect(observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.any(Error),
    });
    expect(originalDiscard).toHaveBeenCalledWith("public-A");
    expect(replacementDiscard).not.toHaveBeenCalled();
  });

  it("snapshots additional state and completion capability before its first await", async () => {
    const originalCompletion = jest.fn(async () => undefined);
    const replacementCompletion = jest.fn(async () => undefined);
    const additionalState = { sessionKey: "session-original" };
    input.additionalState = additionalState;
    input.complete = originalCompletion;
    const started = start();
    additionalState.sessionKey = "session-mutated";
    input.complete = replacementCompletion;
    const { observed } = await started;
    deliverDiscord();
    await tick();
    await observed.settled;
    expect(originalCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: "session-original" }),
    );
    expect(replacementCompletion).not.toHaveBeenCalled();
  });
});
