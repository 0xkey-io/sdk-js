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

type FakeWidgetOptions = {
  sitekey: string;
  appearance: string;
  execution: string;
  "response-field": boolean;
  callback(token: string): void;
  "error-callback"(): void;
  "expired-callback"(): void;
  "timeout-callback"(): void;
};

function rendererModule() {
  jest.resetModules();
  return require("../utils/captcha-turnstile-renderer") as typeof import("../utils/captcha-turnstile-renderer");
}

function fakeTurnstile() {
  const rendered: Array<{
    container: HTMLElement;
    options: FakeWidgetOptions;
  }> = [];
  const executed: string[] = [];
  const reset: string[] = [];
  const removed: string[] = [];
  const api = {
    render(container: HTMLElement, options: FakeWidgetOptions) {
      rendered.push({ container, options });
      return `widget-${rendered.length}`;
    },
    execute(id: string) {
      executed.push(id);
    },
    reset(id: string) {
      reset.push(id);
    },
    remove(id: string) {
      removed.push(id);
    },
  };
  Object.defineProperty(window, "turnstile", {
    configurable: true,
    value: api,
  });
  return { rendered, executed, reset, removed };
}

function container() {
  const node = document.createElement("div");
  document.body.append(node);
  return node;
}

function loadedScript() {
  const scripts = Array.from(document.querySelectorAll("script")).filter(
    (script) => script.src.includes("/turnstile/v0/api.js"),
  );
  expect(scripts).toHaveLength(1);
  expect(scripts[0]?.src).toBe(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
  );
  return scripts[0]!;
}

beforeEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll("script").forEach((script) => script.remove());
});

afterEach(() => {
  delete (window as unknown as { turnstile?: unknown }).turnstile;
  document.body.replaceChildren();
  document.head.querySelectorAll("script").forEach((script) => script.remove());
});

describe("explicit Turnstile challenge renderer", () => {
  it("times out a stale script load and permits a later retry", async () => {
    jest.useFakeTimers();
    try {
      const staleScript = document.createElement("script");
      staleScript.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      document.head.append(staleScript);
      staleScript.dispatchEvent(new Event("load"));
      const { createTurnstileChallengeRenderer } = rendererModule();
      const renderer = createTurnstileChallengeRenderer(container());
      const first = expect(
        renderer.challenge("site-a", new AbortController().signal),
      ).rejects.toThrow("Turnstile script unavailable");
      jest.advanceTimersByTime(15_000);
      await first;

      const fake = fakeTurnstile();
      const second = renderer.challenge("site-a", new AbortController().signal);
      await Promise.resolve();
      await Promise.resolve();
      expect(fake.rendered).toHaveLength(1);
      fake.rendered[0]!.options.callback("fresh-token");
      (await second).reset();
    } finally {
      jest.useRealTimers();
    }
  });

  it("loads a fresh script after an externally owned script fails without an API", async () => {
    jest.useFakeTimers();
    try {
      const staleScript = document.createElement("script");
      staleScript.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      document.head.append(staleScript);
      staleScript.dispatchEvent(new Event("error"));
      const { createTurnstileChallengeRenderer } = rendererModule();
      const renderer = createTurnstileChallengeRenderer(container());
      const first = expect(
        renderer.challenge("site-a", new AbortController().signal),
      ).rejects.toThrow("Turnstile script unavailable");
      jest.advanceTimersByTime(15_000);
      await first;

      const second = renderer.challenge("site-a", new AbortController().signal);
      const scripts = Array.from(document.querySelectorAll("script")).filter(
        (script) => script.src.includes("/turnstile/v0/api.js"),
      );
      expect(scripts).toHaveLength(2);
      const fake = fakeTurnstile();
      scripts[1]!.dispatchEvent(new Event("load"));
      await Promise.resolve();
      await Promise.resolve();
      fake.rendered[0]!.options.callback("fresh-token");
      (await second).reset();
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects a synchronous success callback followed by execute failure", async () => {
    const { createTurnstileChallengeRenderer } = rendererModule();
    const renderer = createTurnstileChallengeRenderer(container());
    const outcome = expect(
      renderer.challenge("site-a", new AbortController().signal),
    ).rejects.toThrow("Turnstile challenge unavailable");
    const script = loadedScript();
    let callback: ((token: string) => void) | undefined;
    const removed: string[] = [];
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: {
        render(_container: HTMLElement, options: FakeWidgetOptions) {
          callback = options.callback;
          return "widget-1";
        },
        execute() {
          callback?.("opaque-token");
          throw new Error("provider internal opaque-token");
        },
        reset: () => undefined,
        remove(id: string) {
          removed.push(id);
        },
      },
    });
    script.dispatchEvent(new Event("load"));
    await outcome;
    expect(removed).toEqual(["widget-1"]);
  });

  it("recovers when a pre-existing script loaded before listeners but the API appears later", async () => {
    const staleScript = document.createElement("script");
    staleScript.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    document.head.append(staleScript);
    staleScript.dispatchEvent(new Event("load"));
    const { createTurnstileChallengeRenderer } = rendererModule();
    const renderer = createTurnstileChallengeRenderer(container());
    const firstController = new AbortController();
    const first = expect(
      renderer.challenge("site-a", firstController.signal),
    ).rejects.toThrow();
    firstController.abort();
    await first;

    const fake = fakeTurnstile();
    const second = renderer.challenge("site-a", new AbortController().signal);
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.rendered).toHaveLength(1);
    fake.rendered[0]!.options.callback("fresh-token");
    const result = await second;
    expect(result.token).toBe("fresh-token");
    result.reset();
  });

  it("loads one fixed official script and executes concurrent widgets with safe options", async () => {
    const { createTurnstileChallengeRenderer } = rendererModule();
    const first = createTurnstileChallengeRenderer(container());
    const second = createTurnstileChallengeRenderer(container());
    const one = first.challenge("site-a", new AbortController().signal);
    const two = second.challenge("site-b", new AbortController().signal);

    const script = loadedScript();
    const fake = fakeTurnstile();
    script.dispatchEvent(new Event("load"));
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.rendered).toHaveLength(2);
    expect(
      fake.rendered.map(({ options }) => ({
        sitekey: options.sitekey,
        appearance: options.appearance,
        execution: options.execution,
        responseField: options["response-field"],
      })),
    ).toEqual([
      {
        sitekey: "site-a",
        appearance: "interaction-only",
        execution: "execute",
        responseField: false,
      },
      {
        sitekey: "site-b",
        appearance: "interaction-only",
        execution: "execute",
        responseField: false,
      },
    ]);
    expect(fake.executed).toEqual(["widget-1", "widget-2"]);

    fake.rendered[0]!.options.callback("opaque-a");
    fake.rendered[1]!.options.callback("opaque-b");
    const resultOne = await one;
    const resultTwo = await two;
    expect([resultOne.token, resultTwo.token]).toEqual([
      "opaque-a",
      "opaque-b",
    ]);
    resultOne.reset();
    resultTwo.reset();
    expect(fake.reset).toEqual(["widget-1", "widget-2"]);
    expect(fake.removed).toEqual(["widget-1", "widget-2"]);
    first.dispose();
    second.dispose();
  });

  it("aborts before script load and never renders a late widget", async () => {
    const { createTurnstileChallengeRenderer } = rendererModule();
    const renderer = createTurnstileChallengeRenderer(container());
    const controller = new AbortController();
    const outcome = expect(
      renderer.challenge("site-a", controller.signal),
    ).rejects.toThrow();
    const script = loadedScript();
    controller.abort();
    await outcome;
    const fake = fakeTurnstile();
    script.dispatchEvent(new Event("load"));
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.rendered).toHaveLength(0);
  });

  it.each(["error-callback", "expired-callback", "timeout-callback"] as const)(
    "fails closed and removes a widget on %s",
    async (callback) => {
      const { createTurnstileChallengeRenderer } = rendererModule();
      const renderer = createTurnstileChallengeRenderer(container());
      const outcome = expect(
        renderer.challenge("site-a", new AbortController().signal),
      ).rejects.toThrow();
      const script = loadedScript();
      const fake = fakeTurnstile();
      script.dispatchEvent(new Event("load"));
      await Promise.resolve();
      await Promise.resolve();
      fake.rendered[0]!.options[callback]();
      await outcome;
      expect(fake.reset).toEqual(["widget-1"]);
      expect(fake.removed).toEqual(["widget-1"]);
    },
  );

  it("does not execute or leak a widget when render reports an immediate error", async () => {
    const { createTurnstileChallengeRenderer } = rendererModule();
    const renderer = createTurnstileChallengeRenderer(container());
    const outcome = expect(
      renderer.challenge("site-a", new AbortController().signal),
    ).rejects.toThrow();
    const script = loadedScript();
    const executed: string[] = [];
    const removed: string[] = [];
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: {
        render(_container: HTMLElement, options: FakeWidgetOptions) {
          options["error-callback"]();
          return "widget-1";
        },
        execute(id: string) {
          executed.push(id);
        },
        reset: () => undefined,
        remove(id: string) {
          removed.push(id);
        },
      },
    });
    script.dispatchEvent(new Event("load"));
    await outcome;
    expect(executed).toEqual([]);
    expect(removed).toEqual(["widget-1"]);
  });

  it("cleans a resolved token on unmount and rejects later challenges", async () => {
    const { createTurnstileChallengeRenderer } = rendererModule();
    const renderer = createTurnstileChallengeRenderer(container());
    const outcome = renderer.challenge("site-a", new AbortController().signal);
    const script = loadedScript();
    const fake = fakeTurnstile();
    script.dispatchEvent(new Event("load"));
    await Promise.resolve();
    await Promise.resolve();
    fake.rendered[0]!.options.callback("opaque-secret");
    const result = await outcome;
    expect(result.token).toBe("opaque-secret");
    renderer.dispose();
    result.reset();
    expect(fake.reset).toEqual(["widget-1"]);
    expect(fake.removed).toEqual(["widget-1"]);
    await expect(
      renderer.challenge("site-a", new AbortController().signal),
    ).rejects.toThrow();
    expect(document.documentElement.outerHTML).not.toContain("opaque-secret");
  });

  it("sanitizes provider cleanup errors while still removing the widget", async () => {
    const { createTurnstileChallengeRenderer } = rendererModule();
    const renderer = createTurnstileChallengeRenderer(container());
    const outcome = renderer.challenge("site-a", new AbortController().signal);
    const script = loadedScript();
    const removed: string[] = [];
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: {
        render(_container: HTMLElement, options: FakeWidgetOptions) {
          queueMicrotask(() => options.callback("opaque-secret"));
          return "widget-1";
        },
        execute: () => undefined,
        reset: () => {
          throw new Error("provider leaked opaque-secret");
        },
        remove(id: string) {
          removed.push(id);
        },
      },
    });
    script.dispatchEvent(new Event("load"));
    const result = await outcome;
    expect(() => result.reset()).toThrow("Turnstile widget cleanup failed");
    expect(removed).toEqual(["widget-1"]);
  });
});
