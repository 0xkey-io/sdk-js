import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { test, expect } from "@jest/globals";
import { getMfaStatus } from "../__generated__/services/coordinator/public/v1/public_api.fetcher";
import { ZeroXKeyClient } from "../__generated__/services/coordinator/public/v1/public_api.client";

const swaggerPath = path.resolve(
  __dirname,
  "../__generated__/services/coordinator/public/v1/public_api.swagger.json",
);
const pinPath = path.resolve(__dirname, "../contract-pin.yaml");

const FROZEN_OPENAPI_SHA256 =
  "b42fcfa9a9480c2d4148038b8d9112559132b11727c7f839e05cb2782e3350e2"; // gitleaks:allow
const FROZEN_SERVICES_COMMIT =
  "096c1fec26bed3b3f8104b473b35903db76760bb";

test("pin records the frozen services OpenAPI hash", () => {
  const pin: Record<string, string> = {};
  for (const line of fs.readFileSync(pinPath, "utf8").split("\n")) {
    const match = line.match(/^(\w+):\s*"([^"]+)"/);
    if (match) {
      pin[match[1]] = match[2];
    }
  }
  expect(pin.openapi_sha256).toBe(FROZEN_OPENAPI_SHA256);
  expect(pin.services_commit).toBe(FROZEN_SERVICES_COMMIT);
});

test("generated package inputs are a current projection of the frozen source", () => {
  const source = path.resolve(__dirname, "../../../../contracts/services-public-api.swagger.json");
  const digest = createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  expect(digest).toBe(FROZEN_OPENAPI_SHA256);
  const check = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "../../../../scripts/sync-services-openapi.js"), "--check"],
    { encoding: "utf8" },
  );
  expect(check.stderr).toBe("");
  expect(check.status).toBe(0);
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
