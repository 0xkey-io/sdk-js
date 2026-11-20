import { afterEach, describe, expect, test } from "@jest/globals";
import { ZeroXKeySDKClientBase } from "../__generated__/sdk-client-base";
import { ZeroXKeyHttpError, ZeroXKeyRequestError } from "../__types__";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function client() {
  return new ZeroXKeySDKClientBase({
    apiBaseUrl: "https://api.example.test",
    authProxyUrl: "https://auth.example.test",
    authProxyConfigId: "config-1",
    organizationId: "org-1",
  });
}

function mockFetch(status: number, statusText: string, body: string) {
  global.fetch = (async () =>
    new Response(body, {
      status,
      statusText,
      headers: { "retry-after": "7" },
    })) as typeof fetch;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("non-JSON error responses keep the HTTP status and a body summary", () => {
  test("coordinator request", async () => {
    mockFetch(401, "Unauthorized", "missing authentication stamp\n");
    const error = await caught(client().getWhoami({ organizationId: "org-1" }));
    expect(error).toBeInstanceOf(ZeroXKeyHttpError);
    expect(error).toMatchObject({
      message: "401 Unauthorized",
      status: 401,
      statusText: "Unauthorized",
      retryAfter: "7",
      bodySummary: "missing authentication stamp",
    });
  });

  test("signed request", async () => {
    mockFetch(502, "Bad Gateway", "<html>upstream down</html>");
    const error = await caught(
      client().sendSignedRequest({
        url: "https://api.example.test/public/v1/query/whoami",
        body: "{}",
        stamp: { stampHeaderName: "X-Stamp", stampHeaderValue: "stamp" },
      }),
    );
    expect(error).toBeInstanceOf(ZeroXKeyHttpError);
    expect(error).toMatchObject({
      status: 502,
      bodySummary: "<html>upstream down</html>",
    });
  });

  test("auth proxy request", async () => {
    mockFetch(503, "Service Unavailable", "try later");
    const error = await caught(
      client().proxyGetAccount({
        filterType: "EMAIL",
        filterValue: "a@b.test",
      }),
    );
    expect(error).toBeInstanceOf(ZeroXKeyHttpError);
    expect(error).toMatchObject({
      status: 503,
      retryAfter: "7",
      bodySummary: "try later",
    });
  });

  test("long bodies are truncated and whitespace is collapsed", async () => {
    mockFetch(500, "Internal Server Error", `a  b\n\n${"x".repeat(500)}`);
    const error = (await caught(
      client().getWhoami({ organizationId: "org-1" }),
    )) as ZeroXKeyHttpError;
    expect(error.bodySummary.startsWith("a b x")).toBe(true);
    expect(error.bodySummary.length).toBeLessThanOrEqual(201);
    expect(error.bodySummary.endsWith("…")).toBe(true);
  });
});

test("JSON error responses from the coordinator carry the HTTP status", async () => {
  mockFetch(
    503,
    "Service Unavailable",
    JSON.stringify({
      code: 14,
      message: "X-Stamp-Attested is not enabled",
      details: [{ reason: "ATTESTED_STAMP_NOT_ENABLED" }],
    }),
  );
  const error = await caught(client().getWhoami({ organizationId: "org-1" }));
  expect(error).toBeInstanceOf(ZeroXKeyRequestError);
  expect(error).toMatchObject({ code: 14, status: 503, retryAfter: "7" });
});
