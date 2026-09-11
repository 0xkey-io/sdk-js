import { test, expect } from "@jest/globals";
import {
  AUTHENTICATORS_NEEDED,
  RECOVERY_SCOPE,
  RECOVERY_TTL_SECONDS,
  isAuthenticatorsNeededStatus,
  missingFactorTypes,
  recoveryIndependenceWarning,
  redactMfaDebugValue,
} from "../mfa";

test("AUTHENTICATORS_NEEDED is a pause, not a terminal status", () => {
  expect(isAuthenticatorsNeededStatus(AUTHENTICATORS_NEEDED)).toBe(true);
  expect(isAuthenticatorsNeededStatus("ACTIVITY_STATUS_COMPLETED")).toBe(false);
  expect(isAuthenticatorsNeededStatus("ACTIVITY_STATUS_FAILED")).toBe(false);
});

test("recovery profile is CREATE_AUTHENTICATORS_V2 with 600s TTL", () => {
  expect(RECOVERY_SCOPE).toContain("ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2");
  expect(RECOVERY_SCOPE).not.toContain("ACTIVITY_TYPE_CREATE_AUTHENTICATORS'");
  expect(RECOVERY_TTL_SECONDS).toBe(600);
});

test("missing factor types omit tokens and contacts", () => {
  const types = missingFactorTypes([
    {
      any: [
        {
          type: "AUTHENTICATION_TYPE_EMAIL_OTP",
          verificationToken: "secret-token",
          contact: "alice@mfa.test",
        },
      ],
    },
    { type: "AUTHENTICATION_TYPE_OAUTH", oidcToken: "oidc-secret" },
  ]);
  expect(types).toEqual([
    "AUTHENTICATION_TYPE_EMAIL_OTP",
    "AUTHENTICATION_TYPE_OAUTH",
  ]);
  const serialized = JSON.stringify(types);
  expect(serialized).not.toContain("secret-token");
  expect(serialized).not.toContain("oidc-secret");
  expect(serialized).not.toContain("alice@mfa.test");
});

test("email plus OAuth recovery is not advertised as independent", () => {
  expect(
    recoveryIndependenceWarning([
      "AUTHENTICATION_TYPE_EMAIL_OTP",
      "AUTHENTICATION_TYPE_OAUTH",
    ]),
  ).toMatch(/not independent/i);
  expect(
    recoveryIndependenceWarning(["AUTHENTICATION_TYPE_EMAIL_OTP"]),
  ).toBeNull();
});

test("debug redact drops stamps, tokens, and bodies", () => {
  const redacted = redactMfaDebugValue({
    type: "AUTHENTICATION_TYPE_EMAIL_OTP",
    verificationToken: "secret-token",
    stamp: { publicKey: "04ab" },
    rawBody: '{"type":"ACTIVITY_TYPE_APPROVE_ACTIVITY"}',
  });
  const serialized = JSON.stringify(redacted);
  expect(serialized).toContain("AUTHENTICATION_TYPE_EMAIL_OTP");
  expect(serialized).not.toContain("secret-token");
  expect(serialized).not.toContain("04ab");
  expect(serialized).not.toContain("APPROVE_ACTIVITY");
});
