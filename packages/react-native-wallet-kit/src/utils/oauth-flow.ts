import { OAuthProviders } from "@0xkey-io/sdk-types";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import {
  buildOAuthState,
  buildOAuthUrl,
  type CompleteOAuthFlowParams,
} from "./oauth";
import {
  createOauthRoutingSnapshot,
  validateOauthCallbackUrl,
  type OauthRoutingSnapshot,
} from "./oauth-routing";
import {
  createOAuthTransactionStore,
  type OAuthTransactionContext,
  type OAuthTransactionError,
  type OAuthTransactionSecureStorage,
} from "./oauth-transaction";

export type FlowResult = "completed" | "ignored";
export type BrowserResult = { type: string; url?: string } | null | undefined;
export type CompletionInput = Pick<
  CompleteOAuthFlowParams,
  "provider" | "publicKey" | "oidcToken" | "sessionKey"
>;
export type ExchangeInput = Readonly<{
  snapshot: OauthRoutingSnapshot;
  publicKey: string;
  nonce: string;
  authCode: string;
  codeVerifier: string;
}>;
export type TrustedOauthFlow = Readonly<{
  snapshot: OauthRoutingSnapshot;
  isCurrent(): boolean;
  exchange(input: ExchangeInput): Promise<string>;
  complete(input: CompletionInput): Promise<void>;
}>;
export type OAuthFlowDependencies = {
  secureStorage: OAuthTransactionSecureStorage;
  now(): number;
  randomBytes(length: number): Uint8Array;
  isBrowserAvailable(): Promise<boolean>;
  openAuth(url: string, returnTarget: string): Promise<BrowserResult>;
  generatePkce(): Promise<{ verifier: string; codeChallenge: string }>;
  createApiKeyPair(): Promise<string>;
  discardUncommittedApiKeyPair(publicKey: string): Promise<void>;
  getConfiguredFlows(): readonly TrustedOauthFlow[];
};
export type OAuthFlowCoordinator = {
  startBrowserOAuth(input: {
    flow: TrustedOauthFlow;
    additionalState?: Readonly<Record<string, string>>;
  }): Promise<void>;
  handleOAuthCallbackUrl(url: string): Promise<FlowResult>;
  retryPendingCleanup(): Promise<void>;
};
type Cleanup = { run(): Promise<void>; pending?: Promise<void> };
type Operation = {
  id: string;
  flow: TrustedOauthFlow;
  warm: boolean;
  settled: boolean;
  cancellationCleanupPending: boolean;
  phase: "pending" | "processing" | "consumed" | "handoff" | "cancelled";
  acceptedState?: string;
  outcome?: Promise<FlowResult>;
  process(url: string, state: string): Promise<FlowResult>;
  cancel(): Promise<void>;
};
type Runtime = { operations: Map<string, Operation>; cleanup: Set<Cleanup> };
const runtimes = new WeakMap<OAuthTransactionSecureStorage, Runtime>();

function sameContext(
  a: OAuthTransactionContext,
  b: OAuthTransactionContext,
): boolean {
  return (
    a.configId === b.configId &&
    a.provider === b.provider &&
    a.binding === b.binding
  );
}
function usesPkce(provider: OAuthProviders): boolean {
  return (
    provider !== OAuthProviders.GOOGLE && provider !== OAuthProviders.APPLE
  );
}
function current(flow: TrustedOauthFlow): boolean {
  try {
    return flow.isCurrent() === true;
  } catch {
    throw new Error("OAuth context unavailable");
  }
}
function requireCurrent(flow: TrustedOauthFlow): void {
  if (!current(flow)) throw new Error("OAuth context changed");
}
function captureFlow(flow: TrustedOauthFlow): TrustedOauthFlow {
  try {
    const s = flow.snapshot;
    const snapshot = createOauthRoutingSnapshot({
      organizationId: s.organizationId,
      apiBaseUrl: s.apiBaseUrl,
      authProxyUrl: s.authProxyUrl,
      ...(s.authProxyConfigId === null
        ? {}
        : { authProxyConfigId: s.authProxyConfigId }),
      provider: s.provider,
      completion: s.completion,
      settings: {
        clientId: s.clientId,
        redirectUri: s.providerRedirectUri,
        appScheme: s.appScheme,
      },
    });
    if (!sameContext(snapshot, s)) throw new Error();
    return Object.freeze({
      snapshot,
      isCurrent: flow.isCurrent.bind(flow),
      exchange: flow.exchange.bind(flow),
      complete: flow.complete.bind(flow),
    });
  } catch {
    throw new Error("OAuth configuration invalid");
  }
}
async function guarded<T>(
  message: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch {
    throw new Error(message);
  }
}

export function createOAuthFlowCoordinator(
  dependencies: OAuthFlowDependencies,
): OAuthFlowCoordinator {
  // Capture one initialized client's capabilities for this coordinator's lifetime.
  const deps = { ...dependencies };
  let shared = runtimes.get(deps.secureStorage);
  if (!shared) {
    shared = { operations: new Map(), cleanup: new Set() };
    runtimes.set(deps.secureStorage, shared);
  }
  const runtime = shared;
  const randomBytes = (length: number): Uint8Array => {
    try {
      const bytes = deps.randomBytes(length);
      if (!(bytes instanceof Uint8Array) || bytes.length !== length)
        throw new Error();
      return new Uint8Array(bytes);
    } catch {
      throw new Error("OAuth randomness unavailable");
    }
  };
  const store = createOAuthTransactionStore({
    secureStorage: deps.secureStorage,
    randomBytes,
    now: () => {
      try {
        const value = deps.now();
        if (!Number.isFinite(value)) throw new Error();
        return value;
      } catch {
        throw new Error("OAuth clock unavailable");
      }
    },
    cleanupTemporaryKey: (key) =>
      guarded("OAuth cleanup failed", () =>
        deps.discardUncommittedApiKeyPair(key),
      ),
  });

  function retry(item: Cleanup): Promise<void> {
    if (item.pending) return item.pending;
    item.pending = guarded("OAuth cleanup failed", item.run).then(
      () => {
        runtime.cleanup.delete(item);
        delete item.pending;
      },
      () => {
        delete item.pending;
        throw new Error("OAuth cleanup failed");
      },
    );
    return item.pending;
  }
  async function cleanup(run: () => Promise<void>): Promise<void> {
    const item = { run };
    runtime.cleanup.add(item);
    // The primary flow failure remains authoritative; retries report separately.
    try {
      await retry(item);
    } catch {
      /* exact capability stays in runtime */
    }
  }
  function discard(publicKey: string): Promise<void> {
    // Retain only the exact key/client capability, never a consumed verifier.
    return cleanup(() => deps.discardUncommittedApiKeyPair(publicKey));
  }
  function release(op: Operation): void {
    if (
      !op.warm &&
      op.settled &&
      !op.cancellationCleanupPending &&
      runtime.operations.get(op.id) === op
    )
      runtime.operations.delete(op.id);
  }
  function track(
    op: Operation,
    promise: Promise<FlowResult>,
  ): Promise<FlowResult> {
    op.outcome = promise;
    const settled = () => {
      op.settled = true;
      release(op);
    };
    // Observe rejected cold-only operations even when no warm waiter remains.
    void promise.then(settled, settled);
    return promise;
  }
  function operation(
    id: string,
    flow: TrustedOauthFlow,
    warm: boolean,
  ): Operation {
    const op: Operation = {
      id,
      flow,
      warm,
      settled: false,
      cancellationCleanupPending: false,
      phase: "pending",
      cancel: () => store.cancelOAuthTransaction(id),
      async process(url, state) {
        requireCurrent(flow);
        const consumed = await guarded("OAuth transaction unavailable", () =>
          store.consumeOAuthTransaction(id, state, flow.snapshot),
        );
        op.phase = "consumed";
        let input: CompletionInput;
        try {
          const params = new URL(url).searchParams;
          let oidcToken: string;
          if (usesPkce(consumed.provider)) {
            const code = params.get("code");
            if (!code || !consumed.codeVerifier)
              throw new Error("OAuth result invalid");
            requireCurrent(flow);
            oidcToken = await guarded("OAuth exchange failed", () =>
              flow.exchange({
                snapshot: flow.snapshot,
                publicKey: consumed.publicKey,
                nonce: bytesToHex(sha256(consumed.publicKey)),
                authCode: code,
                codeVerifier: consumed.codeVerifier!,
              }),
            );
          } else {
            oidcToken = params.get("id_token") ?? "";
          }
          if (typeof oidcToken !== "string" || !oidcToken)
            throw new Error("OAuth result invalid");
          const sessionKey = new URLSearchParams(state).get("sessionKey");
          input = {
            provider: consumed.provider,
            publicKey: consumed.publicKey,
            oidcToken,
            ...(sessionKey === null ? {} : { sessionKey }),
          };
          requireCurrent(flow);
        } catch (error) {
          await discard(consumed.publicKey);
          throw error;
        }
        // Irrevocable handoff. Preserve existing typed completion/MFA errors.
        op.phase = "handoff";
        await flow.complete(input);
        return "completed";
      },
    };
    return op;
  }
  function admit(
    op: Operation,
    url: string,
    state: string,
  ): Promise<FlowResult> {
    if (op.outcome) {
      if (op.phase === "cancelled") return Promise.resolve("ignored");
      if (op.acceptedState !== state)
        return Promise.reject(new Error("OAuth callback invalid"));
      return op.outcome;
    }
    requireCurrent(op.flow);
    op.phase = "processing";
    op.acceptedState = state;
    return track(op, op.process(url, state));
  }
  function abort(op: Operation, message: string): Promise<FlowResult> {
    if (op.outcome) return op.outcome;
    op.phase = "cancelled";
    // A failed initial store read installs no intent. Keep this operation's
    // admission barrier until its ID-only cancellation capability is finished.
    op.cancellationCleanupPending = true;
    return track(
      op,
      (async () => {
        await cleanup(async () => {
          await op.cancel();
          op.cancellationCleanupPending = false;
          release(op);
        });
        throw new Error(message);
      })(),
    );
  }

  return {
    async startBrowserOAuth(input) {
      const flow = captureFlow(input.flow);
      let additionalState: Record<string, string>;
      try {
        additionalState = Object.freeze({ ...input.additionalState });
        if (
          Object.values(additionalState).some(
            (value) => typeof value !== "string",
          )
        )
          throw new Error();
        buildOAuthState({
          provider: flow.snapshot.provider,
          flow: "redirect",
          publicKey: "validation",
          additionalState,
        });
      } catch {
        throw new Error("OAuth additional state invalid");
      }
      requireCurrent(flow);
      if (
        !(await guarded("OAuth browser unavailable", deps.isBrowserAvailable))
      )
        throw new Error("OAuth browser unavailable");
      randomBytes(16);
      const pkce = usesPkce(flow.snapshot.provider)
        ? await guarded("OAuth PKCE unavailable", async () => {
            const { verifier, codeChallenge } = await deps.generatePkce();
            if (
              typeof verifier !== "string" ||
              !verifier ||
              typeof codeChallenge !== "string" ||
              !codeChallenge
            )
              throw new Error();
            return Object.freeze({ verifier, codeChallenge });
          })
        : undefined;
      const publicKey = await guarded(
        "OAuth key creation failed",
        deps.createApiKeyPair,
      );
      let launchUrl = "";
      let id: string;
      // Only this sanitized store call can supply ownership retry handles.
      try {
        const begun = await store.beginOAuthTransaction({
          configId: flow.snapshot.configId,
          provider: flow.snapshot.provider,
          binding: flow.snapshot.binding,
          publicKey,
          ...(pkce ? { codeVerifier: pkce.verifier } : {}),
          createExpectedState: (transactionId) => {
            launchUrl = buildOAuthUrl({
              provider: flow.snapshot.provider,
              clientId: flow.snapshot.clientId,
              redirectUri: flow.snapshot.providerRedirectUri,
              publicKey,
              nonce: bytesToHex(sha256(publicKey)),
              transactionId,
              additionalState,
              ...(pkce ? { codeChallenge: pkce.codeChallenge } : {}),
              useOauthProxyOrigin:
                flow.snapshot.provider !== OAuthProviders.X &&
                flow.snapshot.provider !== OAuthProviders.DISCORD,
            });
            return new URL(launchUrl).searchParams.get("state")!;
          },
        });
        id = begun.id;
      } catch (error) {
        const beginError = error as OAuthTransactionError;
        const handle =
          typeof beginError.transactionId === "string" &&
          /^[0-9a-f]{32}$/.test(beginError.transactionId)
            ? beginError.transactionId
            : typeof beginError.cleanupRetryId === "string" &&
                /^cleanup\.[0-9a-f]{32}$/.test(beginError.cleanupRetryId)
              ? beginError.cleanupRetryId
              : undefined;
        if (handle) {
          // The store already attempted cleanup. Retain its sole retry capability.
          runtime.cleanup.add({
            run: () => store.cancelOAuthTransaction(handle),
          });
        } else await discard(publicKey);
        throw new Error("OAuth transaction begin failed");
      }
      const op = operation(id, flow, true);
      runtime.operations.set(id, op);
      try {
        try {
          requireCurrent(flow);
        } catch {
          await abort(op, "OAuth context changed");
          return;
        }
        let result: BrowserResult;
        try {
          const response = await deps.openAuth(
            launchUrl,
            flow.snapshot.appReturnTarget,
          );
          result =
            response == null
              ? response
              : {
                  type: response.type,
                  ...(response.url === undefined ? {} : { url: response.url }),
                };
        } catch {
          await abort(op, "OAuth browser failed");
          return;
        }
        if (!result || result.type !== "success" || !result.url) {
          await abort(op, "OAuth browser cancelled");
          return;
        }
        let callback: ReturnType<typeof validateOauthCallbackUrl>;
        try {
          callback = validateOauthCallbackUrl(flow.snapshot, result.url);
          if (callback.transactionId !== op.id) throw new Error();
        } catch {
          await abort(op, "OAuth callback invalid");
          return;
        }
        if (!op.outcome) {
          try {
            requireCurrent(flow);
          } catch {
            await abort(op, "OAuth context changed");
            return;
          }
        }
        await admit(op, result.url, callback.returnedState);
      } finally {
        op.warm = false;
        release(op);
      }
    },
    async handleOAuthCallbackUrl(url) {
      let configured: readonly TrustedOauthFlow[];
      try {
        configured = deps.getConfiguredFlows().map(captureFlow);
      } catch {
        throw new Error("OAuth configuration invalid");
      }
      const candidates = [
        ...configured,
        ...Array.from(runtime.operations.values(), (op) => op.flow),
      ];
      let malformed = false;
      for (const flow of candidates) {
        if (!current(flow)) continue;
        let callback: ReturnType<typeof validateOauthCallbackUrl>;
        try {
          callback = validateOauthCallbackUrl(flow.snapshot, url);
        } catch (error) {
          // Only this local validator's fixed classification is inspected.
          if (
            error instanceof Error &&
            error.message !== "Invalid OAuth callback route"
          )
            malformed = true;
          continue;
        }
        const { transactionId, returnedState } = callback;
        let owner = runtime.operations.get(transactionId);
        if (owner) {
          if (
            !sameContext(owner.flow.snapshot, flow.snapshot) ||
            !current(owner.flow)
          )
            continue;
          return admit(owner, url, returnedState);
        }
        const context = await guarded("OAuth transaction unavailable", () =>
          store.getOAuthTransactionContext(transactionId),
        );
        if (!context || !sameContext(context, flow.snapshot) || !current(flow))
          continue;
        // Selection awaited I/O: another receiver may have admitted meanwhile.
        owner = runtime.operations.get(transactionId);
        if (owner) {
          if (
            !sameContext(owner.flow.snapshot, flow.snapshot) ||
            !current(owner.flow)
          )
            continue;
        } else {
          owner = operation(transactionId, flow, false);
          runtime.operations.set(transactionId, owner);
        }
        return admit(owner, url, returnedState);
      }
      if (malformed) throw new Error("OAuth callback invalid");
      return "ignored";
    },
    async retryPendingCleanup() {
      const results = await Promise.allSettled(
        Array.from(runtime.cleanup, retry),
      );
      if (results.some((result) => result.status === "rejected"))
        throw new Error("OAuth cleanup failed");
    },
  };
}
