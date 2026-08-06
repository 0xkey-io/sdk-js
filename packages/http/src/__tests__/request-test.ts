import { fetch } from "../universal";
import { afterEach, test, expect, jest } from "@jest/globals";
import { RateLimitError, ZeroXKeyApi, init } from "../index";
import { readFixture } from "../__fixtures__/shared";

jest.mock("cross-fetch");

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

function response(input: {
  status: number;
  body?: Record<string, unknown>;
  retryAfter?: string;
  statusText?: string;
}): any {
  const headers = {
    get: (name: string) =>
      name.toLowerCase() === "retry-after" ? (input.retryAfter ?? null) : null,
  };
  const value = {
    status: input.status,
    statusText: input.statusText ?? "",
    ok: input.status >= 200 && input.status < 300,
    headers,
    json: async () => input.body ?? {},
  };
  return { ...value, clone: () => response(input) };
}

test("requests are stamped after initialization", async () => {
  const { privateKey, publicKey } = await readFixture();

  init({
    apiPublicKey: publicKey,
    apiPrivateKey: privateKey,
    baseUrl: "https://mocked.0xkey.com",
  });

  const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

  const response: any = {};
  response.status = 200;
  response.ok = true;
  response.json = async () => ({});

  mockedFetch.mockReturnValue(Promise.resolve(response));

  await ZeroXKeyApi.getWhoami({
    body: {
      organizationId: "89881fc7-6ff3-4b43-b962-916698f8ff58",
    },
  });

  expect(fetch).toHaveBeenCalledTimes(1);

  const stamp = (mockedFetch.mock.lastCall![1]?.headers as any)?.["X-Stamp"];
  expect(stamp).toBeTruthy();
});

test("requests return grpc status details as part of their errors", async () => {
  const { privateKey, publicKey } = await readFixture();

  init({
    apiPublicKey: publicKey,
    apiPrivateKey: privateKey,
    baseUrl: "https://mocked.0xkey.com",
  });

  const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

  const response: any = {};
  response.status = 200;
  response.ok = false;
  response.json = async () => ({
    code: 1,
    message: "invalid request",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.BadRequest",
        fieldViolations: [
          {
            field: "privateKeys.0.privateKeyName",
            description: "This field must be unique.",
          },
        ],
      },
    ],
  });

  mockedFetch.mockReturnValue(Promise.resolve(response));

  try {
    await ZeroXKeyApi.getWhoami({
      body: {
        organizationId: "89881fc7-6ff3-4b43-b962-916698f8ff58",
      },
    });
  } catch (e: any) {
    expect(e.message).toEqual(
      `ZeroXKey error 1: invalid request (Details: [{\"@type\":\"type.googleapis.com/google.rpc.BadRequest\",\"fieldViolations\":[{\"field\":\"privateKeys.0.privateKeyName\",\"description\":\"This field must be unique.\"}]}])`,
    );

    expect(e.details.length).toEqual(1);
    expect(e.details[0].fieldViolations.length).toEqual(1);
    expect(e.details[0].fieldViolations[0].field).toEqual(
      "privateKeys.0.privateKeyName",
    );
    expect(e.details[0].fieldViolations[0].description).toEqual(
      "This field must be unique.",
    );
  }
});

test("rate-limited requests retry with the same signed request", async () => {
  const { privateKey, publicKey } = await readFixture();
  init({
    apiPublicKey: publicKey,
    apiPrivateKey: privateKey,
    baseUrl: "https://mocked.0xkey.com",
  });
  jest.spyOn(Math, "random").mockReturnValue(0);

  const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;
  mockedFetch
    .mockResolvedValueOnce(
      response({
        status: 429,
        retryAfter: "0",
        body: { code: "RATE_LIMIT_EXCEEDED", lane: "query" },
      }),
    )
    .mockResolvedValueOnce(
      response({
        status: 429,
        retryAfter: "0",
        body: { code: "RATE_LIMIT_EXCEEDED", lane: "query" },
      }),
    )
    .mockResolvedValueOnce(response({ status: 200, body: {} }));

  await ZeroXKeyApi.getWhoami({
    body: { organizationId: "89881fc7-6ff3-4b43-b962-916698f8ff58" },
  });

  expect(mockedFetch).toHaveBeenCalledTimes(3);
  const firstInit = mockedFetch.mock.calls[0]![1];
  expect(mockedFetch.mock.calls[1]![1]).toEqual(firstInit);
  expect(mockedFetch.mock.calls[2]![1]).toEqual(firstInit);
});

test("rate-limit retry budget returns a structured error", async () => {
  const { privateKey, publicKey } = await readFixture();
  init({
    apiPublicKey: publicKey,
    apiPrivateKey: privateKey,
    baseUrl: "https://mocked.0xkey.com",
  });

  const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;
  mockedFetch.mockResolvedValue(
    response({
      status: 429,
      retryAfter: "6",
      body: {
        code: "RATE_LIMIT_EXCEEDED",
        detail: "slow down",
        lane: "activity",
        scope: "root",
        requestId: "req-1",
      },
    }),
  );

  await expect(
    ZeroXKeyApi.getWhoami({
      body: { organizationId: "89881fc7-6ff3-4b43-b962-916698f8ff58" },
    }),
  ).rejects.toMatchObject({
    name: "RateLimitError",
    status: 429,
    code: "RATE_LIMIT_EXCEEDED",
    retryAfterMs: 6000,
    lane: "activity",
    scope: "root",
    requestId: "req-1",
  } satisfies Partial<RateLimitError>);
  expect(mockedFetch).toHaveBeenCalledTimes(1);
});

test("unrelated problem-json 503 responses are not retried", async () => {
  const { privateKey, publicKey } = await readFixture();
  init({
    apiPublicKey: publicKey,
    apiPrivateKey: privateKey,
    baseUrl: "https://mocked.0xkey.com",
  });

  const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;
  mockedFetch.mockResolvedValue(
    response({
      status: 503,
      body: { code: 14, message: "service unavailable", details: [] },
    }),
  );

  await expect(
    ZeroXKeyApi.getWhoami({
      body: { organizationId: "89881fc7-6ff3-4b43-b962-916698f8ff58" },
    }),
  ).rejects.toThrow("service unavailable");
  expect(mockedFetch).toHaveBeenCalledTimes(1);
});
