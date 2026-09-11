import * as fs from "fs";
import * as path from "path";
import { test, expect } from "@jest/globals";
import { getMfaStatus } from "../__generated__/services/coordinator/public/v1/public_api.fetcher";
import { ZeroXKeyClient } from "../__generated__/services/coordinator/public/v1/public_api.client";

const swaggerPath = path.resolve(
  __dirname,
  "../__generated__/services/coordinator/public/v1/public_api.swagger.json",
);
const pinPath = path.resolve(__dirname, "../contract-pin.yaml");

const FROZEN_OPENAPI_SHA256 =
  "5434f36777abe0672c53e8c0b5b1938147de78a235ddb938f5877b616e6644ad"; // gitleaks:allow

test("pin records the frozen services OpenAPI hash", () => {
  const pin: Record<string, string> = {};
  for (const line of fs.readFileSync(pinPath, "utf8").split("\n")) {
    const match = line.match(/^(\w+):\s*"([^"]+)"/);
    if (match) {
      pin[match[1]] = match[2];
    }
  }
  expect(pin.openapi_sha256).toBe(FROZEN_OPENAPI_SHA256);
  expect(pin.services_commit).toMatch(/^[0-9a-f]{40}$/);
});

test("swagger includes AUTHENTICATORS_NEEDED and get_mfa_status", () => {
  const swagger = JSON.parse(fs.readFileSync(swaggerPath, "utf8")) as {
    paths: Record<string, unknown>;
    definitions: { v1ActivityStatus?: { enum?: string[] } };
  };
  expect(swagger.paths["/public/v1/query/get_mfa_status"]).toBeDefined();
  expect(swagger.definitions.v1ActivityStatus?.enum).toContain(
    "ACTIVITY_STATUS_AUTHENTICATORS_NEEDED",
  );
});

test("generated fetcher and client expose getMfaStatus", () => {
  expect(typeof getMfaStatus).toBe("function");
  const client = new ZeroXKeyClient(
    { baseUrl: "https://api.0xkey.io" },
    {
      stamp: async () => ({
        stampHeaderName: "X-Stamp",
        stampHeaderValue: "test",
      }),
    },
  );
  expect(typeof client.getMfaStatus).toBe("function");
});
