import type { CaptchaChallenge } from "./captcha-attempt-gate";

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type WidgetOptions = {
  sitekey: string;
  appearance: "interaction-only";
  execution: "execute";
  "response-field": false;
  callback(token: string): void;
  "error-callback"(): void;
  "expired-callback"(): void;
  "timeout-callback"(): void;
};

type TurnstileApi = {
  render(container: HTMLElement, options: WidgetOptions): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

const scriptLoads = new WeakMap<Document, Promise<TurnstileApi>>();
const failedPriorScripts = new WeakSet<HTMLScriptElement>();
const SCRIPT_LOAD_TIMEOUT_MS = 15_000;

function turnstileFrom(view: Window): TurnstileApi | undefined {
  const candidate = (view as Window & { turnstile?: Partial<TurnstileApi> })
    .turnstile;
  if (
    candidate &&
    typeof candidate.render === "function" &&
    typeof candidate.execute === "function" &&
    typeof candidate.reset === "function" &&
    typeof candidate.remove === "function"
  ) {
    return candidate as TurnstileApi;
  }
  return undefined;
}

function loadTurnstile(doc: Document): Promise<TurnstileApi> {
  const view = doc.defaultView;
  if (!view) return Promise.reject(new Error("Turnstile requires a browser"));
  const alreadyLoaded = turnstileFrom(view);
  if (alreadyLoaded) return Promise.resolve(alreadyLoaded);
  const existing = scriptLoads.get(doc);
  if (existing) return existing;
  const priorScript = Array.from(doc.querySelectorAll("script")).find(
    (script) =>
      script.src === TURNSTILE_SCRIPT_URL && !failedPriorScripts.has(script),
  );

  const script = priorScript ?? doc.createElement("script");
  let appendScript: (() => void) | undefined;
  const loading = new Promise<TurnstileApi>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const clear = () => {
      script.removeEventListener("load", succeed);
      script.removeEventListener("error", fail);
      clearTimeout(timeout);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      clear();
      if (priorScript) failedPriorScripts.add(script);
      else script.remove();
      scriptLoads.delete(doc);
      reject(new Error("Turnstile script unavailable"));
    };
    const succeed = () => {
      if (settled) return;
      const api = turnstileFrom(view);
      if (!api) {
        fail();
        return;
      }
      settled = true;
      clear();
      resolve(api);
    };
    script.addEventListener("load", succeed);
    script.addEventListener("error", fail);
    timeout = setTimeout(fail, SCRIPT_LOAD_TIMEOUT_MS);
    if (!priorScript) {
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      appendScript = () => doc.head.append(script);
    }
  });
  scriptLoads.set(doc, loading);
  appendScript?.();
  return loading;
}

/** Use a dedicated empty container; dispose when its React owner unmounts. */
export function createTurnstileChallengeRenderer(container: HTMLElement) {
  let disposed = false;
  let active: { cancel(): void } | undefined;

  async function challenge(
    siteKey: string,
    signal: AbortSignal,
  ): Promise<CaptchaChallenge> {
    if (disposed || active || signal.aborted) {
      throw new Error("Turnstile challenge unavailable");
    }
    if (!siteKey || !siteKey.trim() || siteKey !== siteKey.trim()) {
      throw new Error("Invalid Turnstile site key");
    }

    let rejectResult!: (error: Error) => void;
    let resolveResult!: (result: CaptchaChallenge) => void;
    const result = new Promise<CaptchaChallenge>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    let api: TurnstileApi | undefined;
    let widgetId: string | undefined;
    let settled = false;
    let cleaned = false;
    let rendering = false;
    let executing = false;
    let pendingToken: string | undefined;
    let failed = false;

    function cleanup() {
      if (cleaned) return;
      // A synchronous callback from render can arrive before its widget ID.
      if (rendering) return;
      cleaned = true;
      signal.removeEventListener("abort", cancel);
      if (active === operation) active = undefined;
      let cleanupFailed = false;
      if (api && widgetId) {
        try {
          api.reset(widgetId);
        } catch {
          cleanupFailed = true;
        }
        try {
          api.remove(widgetId);
        } catch {
          cleanupFailed = true;
        }
      }
      try {
        container.replaceChildren();
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) throw new Error("Turnstile widget cleanup failed");
    }

    function fail(message: string) {
      failed = true;
      if (!settled) {
        settled = true;
        rejectResult(new Error(message));
      }
      try {
        cleanup();
      } catch {
        // Cleanup failure must not expose provider details or a token.
      }
    }

    function cancel() {
      fail("Turnstile challenge canceled");
    }

    const operation = { cancel };
    active = operation;
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();

    void loadTurnstile(container.ownerDocument)
      .then((loadedApi) => {
        if (settled || disposed || active !== operation || signal.aborted)
          return;
        api = loadedApi;
        const options: WidgetOptions = {
          sitekey: siteKey,
          appearance: "interaction-only",
          execution: "execute",
          "response-field": false,
          callback(token) {
            if (settled || signal.aborted) return;
            if (typeof token !== "string" || !token.trim()) {
              fail("Turnstile challenge returned no token");
              return;
            }
            if (rendering || executing) {
              pendingToken = token;
              return;
            }
            settled = true;
            resolveResult({ token, reset: cleanup });
          },
          "error-callback"() {
            fail("Turnstile challenge failed");
          },
          "expired-callback"() {
            fail("Turnstile challenge expired");
          },
          "timeout-callback"() {
            fail("Turnstile challenge timed out");
          },
        };
        try {
          rendering = true;
          widgetId = loadedApi.render(container, options);
          rendering = false;
          if (settled) {
            if (failed) cleanup();
            return;
          }
          if (!widgetId || signal.aborted || disposed) {
            fail("Turnstile challenge unavailable");
            return;
          }
          executing = true;
          loadedApi.execute(widgetId);
          executing = false;
          if (pendingToken && !settled) {
            settled = true;
            resolveResult({ token: pendingToken, reset: cleanup });
            pendingToken = undefined;
          }
        } catch {
          rendering = false;
          executing = false;
          pendingToken = undefined;
          fail("Turnstile challenge unavailable");
        }
      })
      .catch(() => fail("Turnstile script unavailable"));

    return result;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    active?.cancel();
  }

  return { challenge, dispose };
}
