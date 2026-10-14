import { describe, expect, jest, it } from "@jest/globals";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  Session,
  SessionType,
  ZeroXKeyError,
  ZeroXKeyErrorCodes,
} from "@0xkey-io/sdk-types";
import { isValidSession, withZeroXKeyErrorHandling } from "../utils/utils";

describe("isValidSession", () => {
  const validSession: Session = {
    sessionType: SessionType.READ_WRITE,
    userId: "user123",
    organizationId: "org123",
    expiry: (Date.now() + 1000 * 60 * 60) / 1000, // 1 hour in the future
    expirationSeconds: "3600",
    token: "<token>",
    publicKey: "<publicKey>",
  };
  const expiredSession: Session = {
    sessionType: SessionType.READ_WRITE,
    userId: "user123",
    organizationId: "org123",
    expiry: (Date.now() - 1000 * 60 * 60) / 1000, // 1 hour in the past
    expirationSeconds: "3600",
    token: "<token>",
    publicKey: "<publicKey>",
  };

  it("returns true for a valid session", () => {
    expect(isValidSession(validSession)).toBe(true);
  });

  it("returns false for an expired session", () => {
    expect(isValidSession(expiredSession)).toBe(false);
  });
});

describe("withZeroXKeyErrorHandling", () => {
  it("resolves with the fn result on success", async () => {
    const result = await withZeroXKeyErrorHandling(
      async () => 42,
      async () => {},
    );
    expect(result).toBe(42);
  });

  it("rethrows the same ZeroXKeyError instance if fn throws one", async () => {
    const original = new ZeroXKeyError(
      "boom",
      ZeroXKeyErrorCodes.INVALID_REQUEST,
    );
    const onError = jest.fn();

    await expect(
      withZeroXKeyErrorHandling(
        async () => {
          throw original;
        },
        async () => {},
        { onError },
        "fallback msg",
        ZeroXKeyErrorCodes.UNKNOWN,
      ),
    ).rejects.toBe(original); // identity check

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(original);
  });

  it("wraps a non-ZeroXKey error using provided fallback message/code", async () => {
    const cause = new Error("network kaboom");
    const onError = jest.fn();

    await expect(
      withZeroXKeyErrorHandling(
        async () => {
          throw cause;
        },
        async () => {},
        { onError },
        "Custom fallback",
        ZeroXKeyErrorCodes.NETWORK_ERROR, // pick any code that exists in your enum
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "Custom fallback",
        code: ZeroXKeyErrorCodes.NETWORK_ERROR,
      }),
    );

    expect(onError).toHaveBeenCalledTimes(1);
    const wrapped = onError.mock.calls?.[0]?.[0];
    expect(wrapped).toBeInstanceOf(ZeroXKeyError);
    expect(onError.mock.calls?.[0]?.[0]).toBeInstanceOf(ZeroXKeyError);
  });

  it("wraps a thrown non-Error value (e.g., string) and still calls onError", async () => {
    const onError = jest.fn();

    await expect(
      withZeroXKeyErrorHandling(
        async () => {
          // eslint-disable-next-line no-throw-literal
          throw "stringly-typed error";
        },
        async () => {},
        { onError },
        "Wrapped non-error",
        ZeroXKeyErrorCodes.UNKNOWN,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "Wrapped non-error",
        code: ZeroXKeyErrorCodes.UNKNOWN,
      }),
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls?.[0]?.[0]).toBeInstanceOf(ZeroXKeyError);
  });

  it("uses default fallback message/code when none are provided", async () => {
    await expect(
      withZeroXKeyErrorHandling(
        async () => {
          throw new Error("boom");
        },
        async () => {},
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "An unknown error occurred",
        code: ZeroXKeyErrorCodes.UNKNOWN,
      }),
    );
  });

  it("does not require callbacks; still wraps and throws", async () => {
    await expect(
      withZeroXKeyErrorHandling(
        async () => {
          throw new Error("no callbacks here");
        },
        async () => {},
      ),
    ).rejects.toBeInstanceOf(ZeroXKeyError);
  });

  it("logs out if ZeroXKeyErrorCodes.SESSION_EXPIRED is encountered", async () => {
    const logout = jest.fn();

    await expect(
      withZeroXKeyErrorHandling(
        async () => {
          throw new ZeroXKeyError(
            "session expired",
            ZeroXKeyErrorCodes.SESSION_EXPIRED,
          );
        },
        async () => {
          logout();
          return;
        },
        {},
        "session expired",
        ZeroXKeyErrorCodes.SESSION_EXPIRED,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "session expired",
        code: ZeroXKeyErrorCodes.SESSION_EXPIRED,
      }),
    );

    expect(logout).toHaveBeenCalledTimes(1);
  });
});

const SRC_DIR = join(__dirname, "..");

function shippedSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "tests" ? [] : shippedSourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function iframeDefault(option: "importIframeUrl" | "exportIframeUrl") {
  const provider = readFileSync(
    join(SRC_DIR, "providers", "client", "Provider.tsx"),
    "utf8",
  );
  const match = provider.match(
    new RegExp(`${option}: config\\.${option} \\?\\? "([^"]+)"`),
  );
  return match?.[1];
}

describe("default hosts", () => {
  it("defaults the import and export iframes to 0xkey.io", () => {
    expect(iframeDefault("importIframeUrl")).toBe("https://import.0xkey.io");
    expect(iframeDefault("exportIframeUrl")).toBe("https://export.0xkey.io");
  });

  it("ships no 0xkey.com host", () => {
    const offenders = shippedSourceFiles(SRC_DIR).filter((path) =>
      /0xkey\.com\b/i.test(readFileSync(path, "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
