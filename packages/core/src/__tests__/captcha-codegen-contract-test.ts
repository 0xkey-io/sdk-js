import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const {
  validateCaptchaHeaderContract,
} = require("../../scripts/captcha-contract.js");

const readSwagger = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const coreSwagger = readSwagger(
  resolve(__dirname, "../__inputs__/auth_proxy.swagger.json"),
);
const typesSwagger = readSwagger(
  resolve(
    __dirname,
    "../../../sdk-types/src/__inputs__/auth_proxy.swagger.json",
  ),
);
const protectedPaths = [
  "/v1/otp_init",
  "/v1/otp_init_v2",
  "/v1/signup",
  "/v1/signup_v2",
];

describe("Captcha codegen input contract", () => {
  test("both Auth Proxy Swagger inputs expose exactly the four protected headers", () => {
    expect(validateCaptchaHeaderContract(coreSwagger)).toEqual(protectedPaths);
    expect(validateCaptchaHeaderContract(typesSwagger)).toEqual(protectedPaths);
    expect(typesSwagger).toEqual(coreSwagger);
  });

  test("rejects a Captcha header on an unprotected route", () => {
    const changed = structuredClone(coreSwagger);
    changed.paths["/v1/account"].post.parameters.push({
      name: "X-Captcha-Token",
      in: "header",
      required: false,
      type: "string",
    });
    expect(() => validateCaptchaHeaderContract(changed)).toThrow(
      "Captcha header route mismatch",
    );
  });

  test("rejects a missing or malformed protected header", () => {
    const missing = structuredClone(coreSwagger);
    missing.paths["/v1/signup_v2"].post.parameters.pop();
    expect(() => validateCaptchaHeaderContract(missing)).toThrow(
      "Captcha header route mismatch",
    );

    const malformed = structuredClone(coreSwagger);
    malformed.paths["/v1/otp_init"].post.parameters[1].required = true;
    expect(() => validateCaptchaHeaderContract(malformed)).toThrow(
      "Captcha header contract mismatch",
    );
  });
});
