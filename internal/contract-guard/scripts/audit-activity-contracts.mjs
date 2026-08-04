import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./lib/paths.mjs";

const CURRENT_CREATE_SUB_ORGANIZATION_TYPE =
  "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8";
const CURRENT_CREATE_SUB_ORGANIZATION_RESULT = "createSubOrganizationResultV8";

/** @param {string} relativePath */
function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/**
 * @param {string} source
 * @param {string} expected
 * @param {string} file
 */
function assertContains(source, expected, file) {
  if (!source.includes(expected)) {
    throw new Error(`${file} is missing the current contract: ${expected}`);
  }
}

const tupleFiles = [
  "packages/sdk-types/scripts/codegen.js",
  "packages/core/scripts/codegen.js",
];

for (const file of tupleFiles) {
  const source = read(file);
  assertContains(source, CURRENT_CREATE_SUB_ORGANIZATION_TYPE, file);
  assertContains(source, "v1CreateSubOrganizationIntentV8", file);
  assertContains(source, "v1CreateSubOrganizationResultV8", file);
}

for (const packageName of ["sdk-server", "sdk-browser"]) {
  const file = `packages/${packageName}/scripts/codegen.js`;
  const source = read(file);
  assertContains(source, CURRENT_CREATE_SUB_ORGANIZATION_TYPE, file);
  assertContains(source, CURRENT_CREATE_SUB_ORGANIZATION_RESULT, file);
  assertContains(source, "TCreateSubOrganizationBodyV8", file);
  assertContains(source, "TCreateSubOrganizationResponseV8", file);
}

const clientPackages = ["core", "sdk-server", "sdk-browser"];

for (const packageName of clientPackages) {
  const file = `packages/${packageName}/src/__generated__/sdk-client-base.ts`;
  const source = read(file);
  const methodStart = source.indexOf("createSubOrganization = async");
  const methodEnd = source.indexOf("stampCreateSubOrganization = async");

  if (methodStart === -1 || methodEnd === -1 || methodEnd <= methodStart) {
    throw new Error(`${file} does not contain the generated create method`);
  }

  const createMethod = source.slice(methodStart, methodEnd);
  assertContains(createMethod, CURRENT_CREATE_SUB_ORGANIZATION_TYPE, file);
  assertContains(createMethod, CURRENT_CREATE_SUB_ORGANIZATION_RESULT, file);
  assertContains(source, "/Result(?:V\\d+)?$/", file);
}

const sdkTypesFile = "packages/sdk-types/src/__generated__/types.ts";
const sdkTypes = read(sdkTypesFile);
const bodyStart = sdkTypes.indexOf(
  "export type TCreateSubOrganizationBody = {",
);
const bodyEnd = sdkTypes.indexOf(
  "export type TCreateSubOrganizationInput",
  bodyStart,
);

if (bodyStart === -1 || bodyEnd === -1) {
  throw new Error(
    `${sdkTypesFile} does not contain the generated request body`,
  );
}

assertContains(
  sdkTypes.slice(bodyStart, bodyEnd),
  "rootUsers: v1RootUserParamsV5[];",
  sdkTypesFile,
);

console.log("Activity contract audit passed.");
