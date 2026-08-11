import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CommerceBootVerificationError,
  verifyCommerceBootProjection,
  verifyWithBootEnvelope,
  type QuorumManifestSetAnchor,
} from "@0xkey-io/crypto";

import {
  verifyDetachedJwsLive,
  verifyEip3009Live,
  type CommerceVerificationResult,
  type HistoricalCommerceKey,
} from "./index";

function bootFailure(error: unknown): CommerceVerificationResult {
  if (!(error instanceof CommerceBootVerificationError)) throw error;
  return { valid: false, claimsHash: null, reason: error.reason };
}

const corpus = require("./artifacts/conformance-v1.json") as any;
const jws = require("./artifacts/pr002/jws-v1.json") as any;
const eip = require("./artifacts/pr002/eip712-v1.json") as any;
const boot = require("./artifacts/boot-v1.json") as any;
const wrongSigner = require("./artifacts/eip3009-wrong-signer.json") as any;

const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const SECP256K1_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

function highSJws(envelope: any): any {
  const [header, payload, signature] = envelope.signature.split(".");
  const raw = Buffer.from(signature, "base64url");
  const s = BigInt(`0x${raw.subarray(32).toString("hex")}`);
  const high = Buffer.from((P256_ORDER - s).toString(16).padStart(64, "0"), "hex");
  return { ...envelope, signature: `${header}.${payload}.${Buffer.concat([raw.subarray(0, 32), high]).toString("base64url")}` };
}

function highSEip(envelope: any): any {
  const signature = envelope.signature as string;
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const high = (SECP256K1_ORDER - s).toString(16).padStart(64, "0");
  return { ...envelope, signature: `${signature.slice(0, 66)}${high}${signature.slice(130)}` };
}

async function runCase(operation: string): Promise<CommerceVerificationResult> {
  if (operation.startsWith("JWS_")) {
    const eddsa = operation === "JWS_EDDSA_VALID";
    let registry = jws.keys as HistoricalCommerceKey[];
    let requiredRole: "ISSUER" | "CUSTODY" | "BOOT" = "ISSUER";
    let audience = jws.audience;
    if (operation === "JWS_CUSTODY_VALID") {
      registry = registry.map((key, index) => index === 0 ? { ...key, role: "CUSTODY" } : key) as HistoricalCommerceKey[];
      requiredRole = "CUSTODY";
    } else if (operation === "JWS_ROLE_MISMATCH") {
      requiredRole = "CUSTODY";
    } else if (operation === "JWS_BOOT_REQUEST") {
      requiredRole = "BOOT";
    } else if (operation === "JWS_BOOT_REGISTRY") {
      registry = registry.map((key, index) => index === 0 ? { ...key, role: "BOOT" } : key) as HistoricalCommerceKey[];
    } else if (operation === "JWS_AUDIENCE_MISMATCH") {
      audience = "openant-commerce-verifier:wrong";
    } else if (operation === "JWS_REVOKED") {
      registry = registry.map((key, index) => index === 0 ? { ...key, revokedAtUnixMs: 0 } : key);
    } else if (operation === "JWS_EXPIRED") {
      registry = registry.map((key, index) => index === 0 ? { ...key, notAfterUnixMs: 2_000 } : key);
    } else if (operation === "JWS_NOT_ACTIVE") {
      registry = registry.map((key, index) => index === 0 ? { ...key, notBeforeUnixMs: 4_000_000_000_000 } : key);
    } else if (operation === "JWS_JWK_KID_MISMATCH") {
      registry = registry.map((key, index) => index === 0 ? { ...key, jwk: { ...key.jwk, kid: "wrong-key" } } : key);
    }
    const envelope = operation === "JWS_ISSUER_MISMATCH"
      ? { ...jws.es256, issuer: "issuer:other:example" }
      : operation === "JWS_KID_MISMATCH"
        ? { ...jws.es256, keyId: "other-key" }
        : operation === "JWS_HIGH_S"
          ? highSJws(jws.es256)
          : eddsa ? jws.eddsa : jws.es256;
    return verifyDetachedJwsLive({
      audience,
      claims: jws.statement,
      envelope,
      keyRegistry: registry,
      profile: jws.statementProfile,
      requiredRole,
      wireVersion: "0.1",
    });
  }
  if (operation.startsWith("EIP3009_")) {
    const envelope = operation === "EIP3009_CORRUPT_SIGNATURE"
      ? { ...eip.envelope, signature: `0x9${eip.envelope.signature.slice(3)}` }
      : operation === "EIP3009_WRONG_SIGNER"
        ? { ...eip.envelope, signature: wrongSigner.signature }
        : operation === "EIP3009_HIGH_S"
          ? highSEip(eip.envelope)
          : eip.envelope;
    return verifyEip3009Live({
      claimedClaimsHash: eip.claimsDigest,
      envelope,
      typedData: eip.typedData,
      walletProofClaims: eip.walletProofClaims,
      wireVersion: "0.1",
    });
  }
  const anchor = boot.anchor as QuorumManifestSetAnchor;
  if (operation === "BOOT_REAL_VALID") {
    await verifyWithBootEnvelope(boot.appProof, boot.bootProof, anchor);
    return { valid: true, claimsHash: null, reason: "VERIFIED" };
  }
  if (operation === "BOOT_EPHEMERAL_MISMATCH" || operation === "BOOT_PIVOT_MISMATCH") {
    const appProof = operation === "BOOT_EPHEMERAL_MISMATCH"
      ? { ...boot.appProof, publicKey: boot.appProof.publicKey.replace(/.$/, boot.appProof.publicKey.endsWith("A") ? "B" : "A") }
      : boot.appProof;
    const bootProof = operation === "BOOT_PIVOT_MISMATCH"
      ? { ...boot.bootProof, qosManifestB64: boot.bootProof.qosManifestB64.replace(/^./, boot.bootProof.qosManifestB64.startsWith("A") ? "B" : "A") }
      : boot.bootProof;
    return verifyCommerceBootProjection(
      appProof,
      bootProof,
      `sha256:${"1".repeat(64)}`,
      anchor,
    ).then(
      () => ({ valid: true, claimsHash: null, reason: "VERIFIED" as const }),
      bootFailure,
    );
  }
  const projection = await verifyCommerceBootProjection(
    boot.appProof,
    boot.bootProof,
    `sha256:${"1".repeat(64)}`,
    anchor,
  ).then(
    () => ({ valid: true, claimsHash: null, reason: "VERIFIED" as const }),
    bootFailure,
  );
  return projection;
}

it("emits the byte-pinned ordered cross-language conformance report without networking", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("network access from public verifier"); }) as typeof fetch;
  try {
    const records = [];
    for (const fixture of corpus.cases as Array<{ id: string; operation: string }>) {
      const outcome = await runCase(fixture.operation);
      records.push({ id: fixture.id, ...outcome });
    }
    const report = `${JSON.stringify(records)}\n`;
    const expected = readFileSync(
      path.join(__dirname, "artifacts", "conformance-report.jsonl"),
      "utf8",
    );
    expect(report).toBe(expected);
    expect(`${JSON.stringify(records)}\n`).toBe(report);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
