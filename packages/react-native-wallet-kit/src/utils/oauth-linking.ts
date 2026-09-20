export type OAuthLinkingSource = {
  getInitialURL(): Promise<string | null>;
  addEventListener(
    type: "url",
    listener: (event: { url: string }) => void,
  ): { remove(): void };
};

export type OAuthLinkingAttachment = {
  setReady(ready: boolean): void;
  dispose(): void;
};

export function attachOAuthLinking(input: {
  linking: OAuthLinkingSource;
  dispatch(url: string): Promise<"completed" | "ignored">;
  onError(error: Error): void;
}): OAuthLinkingAttachment {
  let ready = false;
  let disposed = false;
  let draining = false;
  const queue: string[] = [];
  const queued = new Set<string>();

  const report = (message: string) => {
    if (disposed) return;
    try {
      const result = input.onError(new Error(message)) as unknown;
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // Notification is advisory and must never create a second rejection.
    }
  };

  const drain = async () => {
    if (draining || disposed || !ready) return;
    draining = true;
    try {
      while (!disposed && ready && queue.length > 0) {
        const url = queue.shift()!;
        queued.delete(url);
        try {
          await input.dispatch(url);
        } catch {
          report("OAuth callback handling failed");
        }
      }
    } finally {
      draining = false;
      if (!disposed && ready && queue.length > 0) void drain();
    }
  };

  const enqueue = (url: string) => {
    if (disposed || typeof url !== "string" || queued.has(url)) return;
    queued.add(url);
    queue.push(url);
    void drain();
  };

  // Subscribe before requesting the initial URL so no native event can fall
  // through the asynchronous startup gap.
  const subscription = input.linking.addEventListener("url", ({ url }) =>
    enqueue(url),
  );
  void input.linking.getInitialURL().then(
    (url) => {
      if (url !== null) enqueue(url);
    },
    () => report("OAuth callback source failed"),
  );

  return {
    setReady(nextReady) {
      if (disposed) return;
      ready = nextReady;
      if (ready) void drain();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ready = false;
      queue.length = 0;
      queued.clear();
      subscription.remove();
    },
  };
}
