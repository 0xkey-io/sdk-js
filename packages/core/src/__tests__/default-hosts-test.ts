import { describe, expect, it, jest } from "@jest/globals";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

jest.mock(
  "@polyfills/window",
  () => ({
    __esModule: true,
    default: {
      localStorage: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
    },
  }),
  { virtual: true },
);
jest.mock(
  "@utils",
  () => ({
    __esModule: true,
    parseSession: jest.fn(),
  }),
  { virtual: true },
);

import { ZeroXKeyClient } from "../__clients__/core";

const SRC_DIR = join(__dirname, "..");

function shippedSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : shippedSourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("default hosts", () => {
  it("defaults the API base URL to api.0xkey.io", () => {
    const client = new ZeroXKeyClient({ organizationId: "org-id" });

    const httpClient = client.createHttpClient();

    expect(httpClient.config.apiBaseUrl).toBe("https://api.0xkey.io");
    expect(httpClient.config.authProxyUrl).toBe("https://authproxy.0xkey.io");
  });

  it("keeps explicitly configured hosts", () => {
    const client = new ZeroXKeyClient({
      organizationId: "org-id",
      apiBaseUrl: "https://api.example.test",
      authProxyUrl: "https://authproxy.example.test",
    });

    const httpClient = client.createHttpClient();

    expect(httpClient.config.apiBaseUrl).toBe("https://api.example.test");
    expect(httpClient.config.authProxyUrl).toBe(
      "https://authproxy.example.test",
    );
  });

  it("ships no 0xkey.com host", () => {
    const offenders = shippedSourceFiles(SRC_DIR).filter((path) =>
      /0xkey\.com\b/i.test(readFileSync(path, "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
