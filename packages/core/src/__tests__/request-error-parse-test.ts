import { describe, expect, test } from "@jest/globals";
import { ZeroXKeyErrorCodes } from "@0xkey-io/sdk-types";
import { ZeroXKeyRequestError } from "../__types__/error";
import { otpRateLimitErrorFrom } from "../utils";

describe("ZeroXKeyRequestError body parsing", () => {
  test("gRPC status body keeps its numeric code and message", () => {
    const error = new ZeroXKeyRequestError({
      code: 3,
      message: "invalid request",
      details: [{ field: "x" }],
    });
    expect(error.code).toBe(3);
    expect(error.errorCode).toBeUndefined();
    expect(error.details).toEqual([{ field: "x" }]);
    expect(error.message).toBe(
      '0xkey error 3: invalid request (Details: [{"field":"x"}])',
    );
  });

  test("falls back to `error` when `message` is missing", () => {
    const error = new ZeroXKeyRequestError({
      error: "OIDC token has expired",
      code: "OIDC_TOKEN_EXPIRED",
    });
    expect(error.message).toBe(
      "0xkey error OIDC_TOKEN_EXPIRED: OIDC token has expired",
    );
  });

  test("falls back to `error` when `message` is empty", () => {
    const error = new ZeroXKeyRequestError({
      message: "",
      error: "OIDC token has expired",
      code: "OIDC_TOKEN_EXPIRED",
    });
    expect(error.message).toContain("OIDC token has expired");
  });

  test("`message` wins over `error` when both are present", () => {
    const error = new ZeroXKeyRequestError({
      message: "from message",
      error: "from error",
      code: 16,
    });
    expect(error.message).toBe("0xkey error 16: from message");
  });

  test("a string code is kept as `errorCode`, and `code` stays a number", () => {
    const error = new ZeroXKeyRequestError({
      error: "OIDC token has expired",
      code: "OIDC_TOKEN_EXPIRED",
    });
    expect(error.errorCode).toBe("OIDC_TOKEN_EXPIRED");
    expect(typeof error.code).toBe("number");
    expect(error.code).toBe(2);
    expect(error.details).toBeNull();
  });

  test("a numeric string code is the gRPC code, not an errorCode", () => {
    const error = new ZeroXKeyRequestError({ code: "16", message: "denied" });
    expect(error.code).toBe(16);
    expect(error.errorCode).toBeUndefined();
  });

  test("a body with neither message nor error does not print `undefined`", () => {
    const error = new ZeroXKeyRequestError({ code: 5 });
    expect(error.message).toBe("0xkey error 5: ");
    expect(error.message).not.toContain("undefined");
  });
  test("signed digits are not a gRPC code: they stay in `errorCode`", () => {
    for (const code of ["+7", "-7", "7.5", " 7"]) {
      const error = new ZeroXKeyRequestError({ code, message: "denied" });
      expect(error.errorCode).toBe(code);
      expect(error.code).toBe(2);
    }
  });
});

describe("ZeroXKeyRequestError in core derives the gRPC code from the HTTP status", () => {
  const response = (status: number) => ({ status, retryAfter: undefined });

  test.each([
    [400, 3],
    [401, 16],
    [403, 7],
    [404, 5],
    [409, 6],
    [412, 9],
    [413, 11],
    [429, 8],
    [499, 1],
    [501, 12],
    [503, 14],
    [504, 4],
    [500, 13],
    [502, 13],
    [418, 2],
  ])(
    "an Auth Proxy body without a numeric code: HTTP %i gives %i",
    (status, code) => {
      const error = new ZeroXKeyRequestError(
        { error: "OIDC token has expired", code: "OIDC_TOKEN_EXPIRED" },
        response(status),
      );
      expect(error.code).toBe(code);
      expect(error.errorCode).toBe("OIDC_TOKEN_EXPIRED");
      expect(error.status).toBe(status);
    },
  );

  test("a body without any code also uses the HTTP status", () => {
    const error = new ZeroXKeyRequestError({ message: "nope" }, response(403));
    expect(error.code).toBe(7);
    expect(error.errorCode).toBeUndefined();
  });

  test("a numeric code in the body wins over the HTTP status", () => {
    const error = new ZeroXKeyRequestError(
      { code: 14, message: "unavailable" },
      response(401),
    );
    expect(error.code).toBe(14);
  });
});

test("otpRateLimitErrorFrom reads the string code from `errorCode`", () => {
  const error = new ZeroXKeyRequestError(
    { code: "OTP_RESEND_COOLDOWN", error: "wait" },
    { status: 429, retryAfter: "9" },
  );
  // Keep only the parsed fields, so the match cannot come from the raw body.
  const parsed = {
    errorCode: error.errorCode,
    code: error.code,
    status: error.status,
    retryAfter: error.retryAfter,
  };
  expect(otpRateLimitErrorFrom(parsed)).toMatchObject({
    code: ZeroXKeyErrorCodes.OTP_RESEND_COOLDOWN,
    retryAfterSeconds: 9,
  });
});
