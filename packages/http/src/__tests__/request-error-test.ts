import { describe, expect, test } from "@jest/globals";
import { ZeroXKeyRequestError } from "../base";

describe("ZeroXKeyRequestError body parsing", () => {
  test("gRPC status body keeps its numeric code and message", () => {
    const error = new ZeroXKeyRequestError({
      code: 3,
      message: "invalid request",
      details: [{ field: "x" }],
    });
    expect(error.code).toBe(3);
    expect(error.reason).toBeUndefined();
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

  test("a string code is kept as `reason`, and `code` stays a number", () => {
    const error = new ZeroXKeyRequestError({
      error: "OIDC token has expired",
      code: "OIDC_TOKEN_EXPIRED",
    });
    expect(error.reason).toBe("OIDC_TOKEN_EXPIRED");
    expect(typeof error.code).toBe("number");
    expect(error.code).toBe(2);
    expect(error.details).toBeNull();
  });

  test("a numeric string code is the gRPC code, not a reason", () => {
    const error = new ZeroXKeyRequestError({ code: "16", message: "denied" });
    expect(error.code).toBe(16);
    expect(error.reason).toBeUndefined();
  });

  test("a body with neither message nor error does not print `undefined`", () => {
    const error = new ZeroXKeyRequestError({ code: 5 });
    expect(error.message).toBe("0xkey error 5: ");
    expect(error.message).not.toContain("undefined");
  });
});
