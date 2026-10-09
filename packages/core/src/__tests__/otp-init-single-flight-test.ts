import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  ZeroXKeyError,
  ZeroXKeyErrorCodes,
  ZeroXKeyRateLimitError,
} from "@0xkey-io/sdk-types";
import { OtpType } from "../__types__";
import { otpRateLimitErrorFrom, parseRetryAfterSeconds } from "../utils";
import { createReadyClient } from "./test-support/ready-client";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
  delete (globalThis as any).document;
  delete (globalThis as any).window;
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

async function ready(authProxyConfigId = "config-1") {
  const client = await createReadyClient();
  Object.assign(client, {
    config: {
      apiBaseUrl: "https://api.example.test",
      authProxyUrl: "https://auth.example.test",
      authProxyConfigId,
      organizationId: "parent-org",
    },
  });
  client.httpClient = client.createHttpClient();
  return client;
}

function okResponse(otpId: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ otpId, otpEncryptionTargetBundle: `bundle-${otpId}` }),
  } as Response;
}

function errorResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: false,
    status,
    statusText: status === 429 ? "Too Many Requests" : "Error",
    headers: new Headers(headers),
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected token");
      return body;
    },
  } as Response;
}

function queueFetch(...responses: Array<Promise<Response> | Response>) {
  const contacts: unknown[] = [];
  global.fetch = jest.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      contacts.push(JSON.parse(String(init?.body)).contact);
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return next;
    },
  ) as unknown as typeof fetch;
  return contacts;
}

describe("initOtp single-flight", () => {
  test("concurrent calls for the same contact share one request and result", async () => {
    const client = await ready();
    const response = deferred<Response>();
    const contacts = queueFetch(response.promise);

    const first = client.initOtp({
      otpType: OtpType.Email,
      contact: "User@Example.test",
    });
    const second = client.initOtp({
      otpType: OtpType.Email,
      contact: "  user@example.TEST ",
    });
    response.resolve(okResponse("otp-1"));

    const [a, b] = await Promise.all([first, second]);
    expect(contacts).toEqual(["User@Example.test"]);
    expect(a).toEqual({
      otpId: "otp-1",
      otpEncryptionTargetBundle: "bundle-otp-1",
    });
    expect(b).toBe(a);
  });

  test("sequential calls each send a request", async () => {
    const client = await ready();
    const contacts = queueFetch(okResponse("otp-1"), okResponse("otp-2"));

    const first = await client.initOtp({
      otpType: OtpType.Email,
      contact: "a@example.test",
    });
    const second = await client.initOtp({
      otpType: OtpType.Email,
      contact: "a@example.test",
    });

    expect(contacts).toHaveLength(2);
    expect(first.otpId).toBe("otp-1");
    expect(second.otpId).toBe("otp-2");
  });

  test("different contacts, OTP types, and auth proxy targets are independent", async () => {
    const client = await ready();
    const contacts = queueFetch(
      okResponse("otp-1"),
      okResponse("otp-2"),
      okResponse("otp-3"),
      okResponse("otp-4"),
    );
    const otherTarget = await ready("config-2");
    const results = await Promise.all([
      client.initOtp({ otpType: OtpType.Email, contact: "a@example.test" }),
      client.initOtp({ otpType: OtpType.Email, contact: "b@example.test" }),
      client.initOtp({ otpType: OtpType.Sms, contact: "a@example.test" }),
      otherTarget.initOtp({
        otpType: OtpType.Email,
        contact: "a@example.test",
      }),
    ]);

    expect(contacts).toHaveLength(4);
    expect(new Set(results.map((result) => result.otpId)).size).toBe(4);
  });

  test("a rejection reaches every concurrent caller and clears the entry", async () => {
    const client = await ready();
    const response = deferred<Response>();
    const contacts = queueFetch(
      response.promise,
      okResponse("otp-after-failure"),
    );

    const first = client
      .initOtp({ otpType: OtpType.Email, contact: "a@example.test" })
      .catch((error: unknown) => error);
    const second = client
      .initOtp({ otpType: OtpType.Email, contact: "a@example.test" })
      .catch((error: unknown) => error);
    response.resolve(
      errorResponse(500, { code: 13, message: "internal", details: [] }),
    );

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBeInstanceOf(ZeroXKeyError);
    expect((a as ZeroXKeyError).code).toBe(ZeroXKeyErrorCodes.INIT_OTP_ERROR);
    expect(b).toBe(a);
    expect(contacts).toHaveLength(1);

    const retry = await client.initOtp({
      otpType: OtpType.Email,
      contact: "a@example.test",
    });
    expect(retry.otpId).toBe("otp-after-failure");
    expect(contacts).toHaveLength(2);
  });
});

describe("initOtp cooldown errors", () => {
  test("maps a 429 cooldown to OTP_RESEND_COOLDOWN using the Retry-After header", async () => {
    const client = await ready();
    queueFetch(
      errorResponse(
        429,
        {
          code: 8,
          message: "OTP_RESEND_COOLDOWN: retry in 12 seconds",
          details: [],
        },
        { "Retry-After": "42" },
      ),
    );

    const error = await client
      .initOtp({ otpType: OtpType.Email, contact: "a@example.test" })
      .catch((error: unknown) => error);

    expect(error).toBeInstanceOf(ZeroXKeyRateLimitError);
    expect((error as ZeroXKeyRateLimitError).code).toBe(
      ZeroXKeyErrorCodes.OTP_RESEND_COOLDOWN,
    );
    expect((error as ZeroXKeyRateLimitError).retryAfterSeconds).toBe(42);
    expect((error as ZeroXKeyRateLimitError).message).toBe(
      "Please wait 42 seconds before requesting another code.",
    );
  });

  test("falls back to the body when the Retry-After header is missing", async () => {
    const client = await ready();
    queueFetch(
      errorResponse(429, {
        code: "OTP_RESEND_COOLDOWN",
        message: "resend cooldown active",
        retryAfterSeconds: 17,
        details: null,
      }),
    );

    const error = (await client
      .initOtp({ otpType: OtpType.Email, contact: "a@example.test" })
      .catch((error: unknown) => error)) as ZeroXKeyRateLimitError;

    expect(error.code).toBe(ZeroXKeyErrorCodes.OTP_RESEND_COOLDOWN);
    expect(error.retryAfterSeconds).toBe(17);
  });

  test("leaves retryAfterSeconds undefined when the server gives no wait time", async () => {
    const client = await ready();
    queueFetch(
      errorResponse(429, {
        code: 8,
        message: "OTP_INIT_RATE_LIMITED",
        details: [],
      }),
    );

    const error = (await client
      .initOtp({ otpType: OtpType.Email, contact: "a@example.test" })
      .catch((error: unknown) => error)) as ZeroXKeyRateLimitError;

    expect(error).toBeInstanceOf(ZeroXKeyRateLimitError);
    expect(error.code).toBe(ZeroXKeyErrorCodes.OTP_INIT_RATE_LIMITED);
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  test("maps a non-JSON 429 using only the Retry-After header", async () => {
    const client = await ready();
    queueFetch(errorResponse(429, undefined, { "retry-after": "5" }));

    const error = (await client
      .initOtp({ otpType: OtpType.Email, contact: "a@example.test" })
      .catch((error: unknown) => error)) as ZeroXKeyRateLimitError;

    expect(error.code).toBe(ZeroXKeyErrorCodes.OTP_INIT_RATE_LIMITED);
    expect(error.retryAfterSeconds).toBe(5);
  });

  test("keeps the existing max-OTP mapping", async () => {
    const client = await ready();
    queueFetch(
      errorResponse(429, {
        code: 8,
        message: "Max number of OTPs have been initiated",
        details: [],
      }),
    );

    const error = (await client
      .initOtp({ otpType: OtpType.Email, contact: "a@example.test" })
      .catch((error: unknown) => error)) as ZeroXKeyError;

    expect(error).not.toBeInstanceOf(ZeroXKeyRateLimitError);
    expect(error.code).toBe(ZeroXKeyErrorCodes.MAX_OTP_INITIATED_ERROR);
  });
});

describe("otpRateLimitErrorFrom", () => {
  test("reads retry_after, RetryInfo details, and message numbers in order", () => {
    expect(
      otpRateLimitErrorFrom({
        status: 429,
        body: { message: "OTP_RESEND_COOLDOWN", retry_after: "9" },
      })?.retryAfterSeconds,
    ).toBe(9);
    expect(
      otpRateLimitErrorFrom({
        status: 429,
        body: {
          message: "OTP_RESEND_COOLDOWN",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay: "3.2s",
            },
          ],
        },
      })?.retryAfterSeconds,
    ).toBe(4);
    expect(
      otpRateLimitErrorFrom(new Error("OTP_RESEND_COOLDOWN: try again in 30s"))
        ?.retryAfterSeconds,
    ).toBe(30);
  });

  test("ignores unrelated failures", () => {
    expect(otpRateLimitErrorFrom(new Error("network down"))).toBeUndefined();
    expect(
      otpRateLimitErrorFrom({ status: 400, message: "bad request" }),
    ).toBeUndefined();
    expect(otpRateLimitErrorFrom("OTP_RESEND_COOLDOWN")).toBeUndefined();
  });

  test("parseRetryAfterSeconds accepts delay-seconds and HTTP-dates", () => {
    jest.useFakeTimers({ now: new Date("2026-10-08T00:00:00Z") });
    expect(parseRetryAfterSeconds("60")).toBe(60);
    expect(parseRetryAfterSeconds(" 1.5 ")).toBe(2);
    expect(parseRetryAfterSeconds("Thu, 08 Oct 2026 00:00:45 GMT")).toBe(45);
    expect(parseRetryAfterSeconds("Wed, 07 Oct 2026 00:00:00 GMT")).toBe(0);
    expect(parseRetryAfterSeconds("-1")).toBeUndefined();
    expect(parseRetryAfterSeconds("soon")).toBeUndefined();
    expect(parseRetryAfterSeconds(undefined)).toBeUndefined();
  });
});
