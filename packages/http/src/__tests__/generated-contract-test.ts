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
  "cca6a179db09bb9ea1d01deabd0b9e7122f4dbc1f27735efdcf433700aee42e2"; // gitleaks:allow
const FROZEN_SERVICES_COMMIT = "0eb6eb86a2ddb875552e97a33880d2c1c1eb4e4e";

test("pin records the frozen services OpenAPI hash", () => {
  const pin: Record<string, string> = {};
  for (const line of fs.readFileSync(pinPath, "utf8").split("\n")) {
    const match = line.match(/^(\w+):\s*"([^"]+)"/);
    if (match) {
      pin[match[1]!] = match[2]!;
    }
  }
  expect(pin.openapi_sha256).toBe(FROZEN_OPENAPI_SHA256);
  expect(pin.services_commit).toBe(FROZEN_SERVICES_COMMIT);
});

test("generated package inputs are a current projection of the frozen source", () => {
  const source = path.resolve(
    __dirname,
    "../../../../contracts/services-public-api.swagger.json",
  );
  const digest = createHash("sha256")
    .update(fs.readFileSync(source))
    .digest("hex");
  expect(digest).toBe(FROZEN_OPENAPI_SHA256);
  const check = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, "../../../../scripts/sync-services-openapi.js"),
      "--check",
    ],
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

test("generated identity contract matches the Turnkey-aligned source", () => {
  const swagger = JSON.parse(fs.readFileSync(swaggerPath, "utf8")) as {
    definitions: {
      externaldatav1Credential: { properties: Record<string, unknown> };
      v1User: {
        properties: Record<string, unknown>;
        required?: string[];
      };
      v1AuthenticationType: { enum?: string[]; default?: string };
    };
  };

  expect(
    swagger.definitions.externaldatav1Credential.properties.sessionProfileId,
  ).toBeDefined();
  expect(swagger.definitions.v1User.properties.mfaPolicies).toBeDefined();
  expect(swagger.definitions.v1User.required).toContain("mfaPolicies");
  expect(swagger.definitions.v1AuthenticationType.enum).not.toContain(
    "AUTHENTICATION_TYPE_UNSPECIFIED",
  );
  expect(swagger.definitions.v1AuthenticationType.default).toBeUndefined();
});

test("projected swagger preserves every referenced public definition", () => {
  const swagger = JSON.parse(fs.readFileSync(swaggerPath, "utf8")) as {
    definitions: Record<string, unknown>;
    paths: Record<string, unknown>;
  };
  const referenced = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if ("$ref" in value && typeof value.$ref === "string") {
      const match = value.$ref.match(/^#\/definitions\/(.+)$/);
      if (match) referenced.add(match[1]!);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(swagger.paths);
  visit(swagger.definitions);

  expect([...referenced].filter((name) => !swagger.definitions[name])).toEqual(
    [],
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
