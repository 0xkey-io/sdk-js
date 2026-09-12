const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "contracts/services-public-api.swagger.json");
const allowlistPath = path.join(root, "contracts/sdk-public-paths.json");
const definitionAllowlistPath = path.join(root, "contracts/sdk-public-definitions.json");
const targets = [
  "packages/http/src/__generated__/services/coordinator/public/v1/public_api.swagger.json",
  "packages/core/src/__inputs__/public_api.swagger.json",
  "packages/sdk-browser/src/__inputs__/public_api.swagger.json",
  "packages/sdk-server/src/__inputs__/public_api.swagger.json",
  "packages/sdk-types/src/__inputs__/public_api.swagger.json",
];

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const allowlist = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
const definitionAllowlist = JSON.parse(fs.readFileSync(definitionAllowlistPath, "utf8"));
const syntheticPaths = {
  "/api/v1/noop-codegen-anchor": {
    post: {
      operationId: "PublicApiService_NOOPCodegenAnchor",
      responses: {
        200: {
          description: "A successful response.",
          schema: { $ref: "#/definitions/v1NOOPCodegenAnchorResponse" },
        },
        default: {
          description: "An unexpected error response.",
          schema: { $ref: "#/definitions/rpcStatus" },
        },
      },
      tags: ["PublicApiService"],
    },
  },
};
const missing = allowlist.filter((route) => !source.paths[route] && !syntheticPaths[route]);
if (missing.length > 0) {
  throw new Error(`frozen services OpenAPI is missing allowlisted paths: ${missing.join(", ")}`);
}
const projection = {
  ...source,
  paths: Object.fromEntries(
    allowlist.map((route) => [route, source.paths[route] || syntheticPaths[route]]),
  ),
  definitions: {
    ...Object.fromEntries(
      definitionAllowlist
        .filter((name) => source.definitions[name])
        .map((name) => [name, source.definitions[name]]),
    ),
    v1NOOPCodegenAnchorResponse: {
      type: "object",
      properties: {
        stamp: { $ref: "#/definitions/v1WebAuthnStamp" },
        tokenUsage: { $ref: "#/definitions/v1TokenUsage" },
      },
      required: ["stamp"],
    },
  },
};
const rendered = JSON.stringify(projection, null, 2) + "\n";
const check = process.argv.includes("--check");
let drift = false;
for (const target of targets) {
  const absolute = path.join(root, target);
  if (check) {
    if (!fs.existsSync(absolute) || fs.readFileSync(absolute, "utf8") !== rendered) {
      console.error(`generated OpenAPI projection is stale: ${target}`);
      drift = true;
    }
  } else {
    fs.writeFileSync(absolute, rendered);
  }
}
if (drift) process.exit(1);
