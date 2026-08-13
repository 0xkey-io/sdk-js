import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";

import {
  COMMERCE_CONTRACT,
  COMMERCE_SCHEMAS,
  type AcceptanceReceipt,
  type ArtifactManifest,
  type CommerceOperation,
  type CommerceReceipt,
  type DeliveryAcknowledgement,
  type DeliveryReceipt,
  type EndpointDescriptorVersion,
  type ExecutionReceipt,
  type FundingUnknownObservation,
  type Invocation,
  type ListingMandate,
  type MandateAuthorizationProof,
  type OfferVersion,
  type OpenAntX402Extension,
  type OutputStagingReceipt,
  type PaymentIntent,
  type PaymentRequiredOutcome,
  type ProofBundle,
  type ProtocolError,
  type RuntimeCapability,
  type SellerIdentityCredential,
  type ServiceDefinitionVersion,
  type ServiceSkuVersion,
  type SettlementReceipt,
  type TaskAgreementVersion,
  type WalletAuthorizationProof,
} from "./rc-bundle/commerce-types";
import { CommerceCodecError, type CommerceCodecErrorCode } from "./codec-error";
import { assertIJson, canonicalizeJcs, digestJcs, sha256Bytes } from "./jcs";
import { parseCommerceJson } from "./strict-json";

export * from "./rc-bundle/commerce-types";
export { CommerceCodecError, type CommerceCodecErrorCode } from "./codec-error";

export type CommerceDocument =
  | AcceptanceReceipt
  | ArtifactManifest
  | CommerceOperation
  | CommerceReceipt
  | DeliveryAcknowledgement
  | DeliveryReceipt
  | EndpointDescriptorVersion
  | ExecutionReceipt
  | FundingUnknownObservation
  | Invocation
  | ListingMandate
  | MandateAuthorizationProof
  | OfferVersion
  | OpenAntX402Extension
  | OutputStagingReceipt
  | PaymentIntent
  | PaymentRequiredOutcome
  | ProofBundle
  | ProtocolError
  | RuntimeCapability
  | SellerIdentityCredential
  | ServiceDefinitionVersion
  | ServiceSkuVersion
  | SettlementReceipt
  | TaskAgreementVersion
  | WalletAuthorizationProof;

export const COMMERCE_CONTRACT_METADATA = Object.freeze({
  protocolVersion: "0.1.0-draft.4",
  wireVersion: "0.1",
  sourceDigest:
    "sha256:0069b449f4b0f2f2ae88103219a182703498231b3e7cbe6d76cdd7e3f195ff27",
  generatorVersion: "0.1.0",
  generatorHash:
    "sha256:8f6d309f509e095b1bbca3c011c0ca046dbbdacb075e84e0b13091581a2a07fa",
  bundleDigest:
    "sha256:61daab4e29396dad5c393a6d0838963106b526849f7e880fa30538ea81cf83f6",
} as const);

function negotiate(offeredVersions: readonly string[]): "0.1" {
  if (offeredVersions.includes(COMMERCE_CONTRACT_METADATA.wireVersion)) {
    return COMMERCE_CONTRACT_METADATA.wireVersion;
  }
  throw new CommerceCodecError("UNSUPPORTED_PROTOCOL_VERSION");
}

const UINT256_MAX = (1n << 256n) - 1n;
const ajv = new Ajv2020({
  allErrors: true,
  strictSchema: true,
  strictTypes: false,
  validateFormats: true,
});

ajv.addFormat("uint256-decimal", {
  type: "string",
  validate(value: string): boolean {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) return false;
    try {
      return BigInt(value) <= UINT256_MAX;
    } catch {
      return false;
    }
  },
});

ajv.addFormat("rfc3339-utc-whole-seconds", {
  type: "string",
  validate(value: string): boolean {
    if (value.startsWith("0000-")) return false;
    if (
      !/^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/.test(
        value,
      )
    ) {
      return false;
    }
    const epochMillis = Date.parse(value);
    return (
      Number.isFinite(epochMillis) &&
      new Date(epochMillis).toISOString().replace(".000Z", "Z") === value
    );
  },
});

const envelopeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:openant:commerce:0.1:envelope",
  $defs: COMMERCE_SCHEMAS,
  oneOf: Object.values(COMMERCE_CONTRACT.objects).map(({ reference }) => ({
    $ref: reference,
  })),
};

const validateEnvelope: ValidateFunction<CommerceDocument> =
  ajv.compile(envelopeSchema);

function decode(input: unknown): CommerceDocument {
  const document =
    typeof input === "string" || input instanceof Uint8Array
      ? parseCommerceJson(input)
      : input;
  assertIJson(document);
  if (
    document !== null &&
    typeof document === "object" &&
    typeof (document as { protocolVersion?: unknown }).protocolVersion ===
      "string" &&
    (document as { protocolVersion: string }).protocolVersion !==
      COMMERCE_CONTRACT_METADATA.wireVersion
  ) {
    throw new CommerceCodecError("UNSUPPORTED_PROTOCOL_VERSION");
  }
  if (!validateEnvelope(document))
    throw new CommerceCodecError("SCHEMA_INVALID");
  return document;
}

export interface CommerceCodecCorpusCase {
  readonly id: string;
  readonly input?: unknown;
  readonly inputJson?: string;
  readonly expected: {
    readonly canonicalSha256: `sha256:${string}` | null;
    readonly errorCode: CommerceCodecErrorCode | null;
  };
}

export interface CommerceCodecCorpus {
  readonly formatVersion: 1;
  readonly protocolVersion: string;
  readonly wireVersion: string;
  readonly sourceDigest: string;
  readonly cases: readonly CommerceCodecCorpusCase[];
}

export interface CommerceCodecRecord {
  readonly id: string;
  readonly canonicalSha256: `sha256:${string}` | null;
  readonly errorCode: CommerceCodecErrorCode | null;
}

export interface CommerceBundleManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: `sha256:${string}`;
}

export interface CommerceBundleManifest {
  readonly formatVersion: 1;
  readonly releaseCandidate: "AC-M0-PR-004/accepted";
  readonly protocolVersion: string;
  readonly wireVersion: string;
  readonly sourceDigest: string;
  readonly generatorVersion: string;
  readonly generatorHash: string;
  readonly files: readonly CommerceBundleManifestFile[];
  readonly bundleDigest: `sha256:${string}`;
}

function encode(input: unknown): Uint8Array {
  return canonicalizeJcs(decode(input));
}

function digest(input: unknown): `sha256:${string}` {
  return digestJcs(decode(input));
}

function assertCorpusCoordinates(corpus: CommerceCodecCorpus): void {
  if (
    corpus.formatVersion !== 1 ||
    corpus.protocolVersion !== COMMERCE_CONTRACT_METADATA.protocolVersion ||
    corpus.wireVersion !== COMMERCE_CONTRACT_METADATA.wireVersion ||
    corpus.sourceDigest !== COMMERCE_CONTRACT_METADATA.sourceDigest ||
    !Array.isArray(corpus.cases)
  ) {
    throw new CommerceCodecError("CONTRACT_DIGEST_MISMATCH");
  }
}

function runCorpus(corpus: CommerceCodecCorpus): CommerceCodecRecord[] {
  assertCorpusCoordinates(corpus);
  const ids = new Set<string>();
  return corpus.cases.map((fixture) => {
    const hasInput = Object.hasOwn(fixture, "input");
    const hasInputJson = Object.hasOwn(fixture, "inputJson");
    if (
      typeof fixture.id !== "string" ||
      fixture.id.length === 0 ||
      ids.has(fixture.id) ||
      hasInput === hasInputJson
    ) {
      throw new CommerceCodecError("CONTRACT_DIGEST_MISMATCH");
    }
    ids.add(fixture.id);
    const input = hasInputJson ? fixture.inputJson : fixture.input;
    try {
      return {
        id: fixture.id,
        canonicalSha256: digest(input),
        errorCode: null,
      };
    } catch (error) {
      if (!(error instanceof CommerceCodecError)) throw error;
      return { id: fixture.id, canonicalSha256: null, errorCode: error.code };
    }
  });
}

function formatReport(records: readonly CommerceCodecRecord[]): string {
  return `${JSON.stringify(
    records.map(({ id, canonicalSha256, errorCode }) => ({
      id,
      canonicalSha256,
      errorCode,
    })),
  )}\n`;
}

function mismatch(): never {
  throw new CommerceCodecError("CONTRACT_DIGEST_MISMATCH");
}

function verifyBundle(
  manifestInput: unknown,
  files: Readonly<Record<string, Uint8Array>>,
): typeof COMMERCE_CONTRACT_METADATA {
  let manifest: CommerceBundleManifest;
  try {
    const parsed =
      typeof manifestInput === "string" || manifestInput instanceof Uint8Array
        ? parseCommerceJson(manifestInput)
        : manifestInput;
    assertIJson(parsed);
    manifest = parsed as unknown as CommerceBundleManifest;
  } catch {
    return mismatch();
  }
  const manifestKeys = [
    "formatVersion",
    "releaseCandidate",
    "protocolVersion",
    "wireVersion",
    "sourceDigest",
    "generatorVersion",
    "generatorHash",
    "files",
    "bundleDigest",
  ].sort();
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    JSON.stringify(Object.keys(manifest).sort()) !==
      JSON.stringify(manifestKeys) ||
    manifest.formatVersion !== 1 ||
    manifest.releaseCandidate !== "AC-M0-PR-004/accepted" ||
    manifest.protocolVersion !== COMMERCE_CONTRACT_METADATA.protocolVersion ||
    manifest.wireVersion !== COMMERCE_CONTRACT_METADATA.wireVersion ||
    manifest.sourceDigest !== COMMERCE_CONTRACT_METADATA.sourceDigest ||
    manifest.generatorVersion !== COMMERCE_CONTRACT_METADATA.generatorVersion ||
    manifest.generatorHash !== COMMERCE_CONTRACT_METADATA.generatorHash ||
    manifest.bundleDigest !== COMMERCE_CONTRACT_METADATA.bundleDigest ||
    !Array.isArray(manifest.files) ||
    manifest.files.some(
      (file) =>
        file === null ||
        typeof file !== "object" ||
        Array.isArray(file) ||
        JSON.stringify(Object.keys(file).sort()) !==
          JSON.stringify(["bytes", "path", "sha256"]),
    )
  ) {
    return mismatch();
  }

  if (
    files === null ||
    typeof files !== "object" ||
    Array.isArray(files) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(files)) ||
    Object.getOwnPropertySymbols(files).length > 0
  ) {
    return mismatch();
  }
  const fileDescriptors = Object.getOwnPropertyDescriptors(files);
  if (
    Object.values(fileDescriptors).some(
      (descriptor) =>
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        !(descriptor.value instanceof Uint8Array),
    )
  ) {
    return mismatch();
  }

  const paths = manifest.files.map((file) => file.path);
  if (
    paths.some((filePath) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filePath)) ||
    paths.some(
      (filePath, index) => index > 0 && paths[index - 1]! >= filePath,
    ) ||
    JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(paths)
  ) {
    return mismatch();
  }
  for (const file of manifest.files) {
    const descriptor = fileDescriptors[file.path];
    const bytes =
      descriptor && "value" in descriptor
        ? (descriptor.value as Uint8Array)
        : undefined;
    if (
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      bytes === undefined ||
      bytes.byteLength !== file.bytes ||
      sha256Bytes(bytes) !== file.sha256
    ) {
      return mismatch();
    }
  }

  const frame = {
    formatVersion: manifest.formatVersion,
    releaseCandidate: manifest.releaseCandidate,
    protocolVersion: manifest.protocolVersion,
    wireVersion: manifest.wireVersion,
    sourceDigest: manifest.sourceDigest,
    generatorVersion: manifest.generatorVersion,
    generatorHash: manifest.generatorHash,
    files: manifest.files,
  };
  if (digestJcs(frame) !== manifest.bundleDigest) return mismatch();
  return COMMERCE_CONTRACT_METADATA;
}

export const commerceContract = Object.freeze({
  decode,
  digest,
  encode,
  formatReport,
  negotiate,
  runCorpus,
  verifyBundle,
});
