import { act, useEffect, type CSSProperties, type ReactNode } from "react";

export type InstrumentedPlayerProps = {
  src: string;
  style?: CSSProperties;
  autoplay?: boolean;
  loop?: boolean;
};

export type PlayerRender = {
  src: string;
  style: CSSProperties | undefined;
  autoplay: boolean | undefined;
  loop: boolean | undefined;
};

export const playerObservations = {
  renders: [] as PlayerRender[],
  mounts: 0,
  unmounts: 0,
};

export function resetPlayerObservations(): void {
  if (playerObservations.mounts !== playerObservations.unmounts) {
    throw new Error(
      "Cannot reset Player observations while a Player is mounted",
    );
  }
  playerObservations.renders.length = 0;
  playerObservations.mounts = 0;
  playerObservations.unmounts = 0;
}

export function InstrumentedPlayer(props: InstrumentedPlayerProps): ReactNode {
  playerObservations.renders.push({
    src: props.src,
    style: props.style ? { ...props.style } : undefined,
    autoplay: props.autoplay,
    loop: props.loop,
  });

  useEffect(() => {
    playerObservations.mounts += 1;
    return () => {
      playerObservations.unmounts += 1;
    };
  }, []);

  return (
    <div
      aria-label="test animation renderer"
      data-testid="test-animation-renderer"
      style={props.style}
    >
      test animation renderer
    </div>
  );
}

type ObserverRecord = {
  observer: ResizeObserver;
  callback: ResizeObserverCallback;
  targets: Set<Element>;
  observed: Element[];
  unobserved: Element[];
  disconnects: number;
  disconnected: boolean;
};

export type ControlledResizeObserver = {
  records: ObserverRecord[];
  liveTargets(): Element[];
  deliver(
    target: Element,
    measurement: { width: number; height: number },
  ): Promise<void>;
  restore(): void;
};

function restoreDescriptor(
  object: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(object, key, descriptor);
  } else {
    Reflect.deleteProperty(object, key);
  }
}

function rect(width: number, height: number): DOMRectReadOnly {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    toJSON: () => ({
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      right: width,
      bottom: height,
      left: 0,
    }),
  };
}

export function installControlledResizeObserver(): ControlledResizeObserver {
  if (globalThis !== window) {
    throw new Error(
      "The jsdom window and global object are distinct; ResizeObserver installation needs review",
    );
  }
  if (typeof globalThis.ResizeObserver !== "undefined") {
    throw new Error(
      "An existing ResizeObserver is present; the controlled adapter will not replace it",
    );
  }

  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "ResizeObserver",
  );
  const records: ObserverRecord[] = [];

  class TestResizeObserver implements ResizeObserver {
    readonly record: ObserverRecord;

    constructor(callback: ResizeObserverCallback) {
      this.record = {
        observer: this,
        callback,
        targets: new Set<Element>(),
        observed: [],
        unobserved: [],
        disconnects: 0,
        disconnected: false,
      };
      records.push(this.record);
    }

    observe(target: Element): void {
      if (!(target instanceof Element)) {
        throw new Error("ResizeObserver received a non-Element target");
      }
      this.record.disconnected = false;
      this.record.targets.add(target);
      this.record.observed.push(target);
    }

    unobserve(target: Element): void {
      this.record.targets.delete(target);
      this.record.unobserved.push(target);
    }

    disconnect(): void {
      this.record.targets.clear();
      this.record.disconnects += 1;
      this.record.disconnected = true;
    }
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  });
  if (window.ResizeObserver !== globalThis.ResizeObserver) {
    restoreDescriptor(globalThis, "ResizeObserver", originalDescriptor);
    throw new Error(
      "ResizeObserver identity differs between window and globalThis",
    );
  }

  let restored = false;
  return {
    records,
    liveTargets: () =>
      records.flatMap((record) =>
        record.disconnected ? [] : [...record.targets],
      ),
    async deliver(target, measurement): Promise<void> {
      const matches = records.filter(
        (record) => !record.disconnected && record.targets.has(target),
      );
      if (matches.length !== 1) {
        throw new Error(
          `Expected one live ResizeObserver for target, received ${matches.length}`,
        );
      }
      const contentRect = rect(measurement.width, measurement.height);
      const size = {
        inlineSize: measurement.width,
        blockSize: measurement.height,
      };
      const entry = {
        target,
        contentRect,
        borderBoxSize: [size],
        contentBoxSize: [size],
        devicePixelContentBoxSize: [size],
      } satisfies ResizeObserverEntry;

      await act(async () => {
        matches[0]!.callback([entry], matches[0]!.observer);
        await Promise.resolve();
      });
    },
    restore(): void {
      if (restored) return;
      restored = true;
      if (globalThis.ResizeObserver !== TestResizeObserver) {
        throw new Error(
          "ResizeObserver changed before the controlled adapter was restored",
        );
      }
      restoreDescriptor(globalThis, "ResizeObserver", originalDescriptor);
    },
  };
}
