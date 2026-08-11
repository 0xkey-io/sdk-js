import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  CommerceBootVerificationError,
  verifyCommerceBootProjection,
  verifyWithBootEnvelope,
  type QuorumManifestSetAnchor,
} from "@0xkey-io/crypto";

import {
  COMMERCE_VERIFIER_METADATA,
  createCommerceVerifier,
  verifyBootBinding,
  verifyCommerceVerifierBundle,
  verifyDetachedJwsLive,
  verifyEip3009Live,
  type HistoricalCommerceKey,
} from "./index";

// Runtime fixture loading keeps immutable JSON artifacts out of the package's
// TypeScript source graph; their bytes are verified separately above.
const eip712Vector = require("./artifacts/pr002/eip712-v1.json") as any;
const jwsVector = require("./artifacts/pr002/jws-v1.json") as any;
const bootVector = require("./artifacts/boot-v1.json") as any;
const wrongSigner = require("./artifacts/eip3009-wrong-signer.json") as any;

const keys = jwsVector.keys as HistoricalCommerceKey[];
const mutateBase64 = (value: string, offset = Math.floor(value.length / 2)): string =>
  `${value.slice(0, offset)}${value[offset] === "A" ? "B" : "A"}${value.slice(offset + 1)}`;
const base64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64url");
const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const SECP256K1_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

function highSJws(signature: string): string {
  const segments = signature.split(".");
  const compact = Buffer.from(segments[2]!, "base64url");
  const s = BigInt(`0x${compact.subarray(32).toString("hex")}`);
  const high = (P256_ORDER - s).toString(16).padStart(64, "0");
  return `${segments[0]}.${segments[1]}.${base64url(Buffer.concat([compact.subarray(0, 32), Buffer.from(high, "hex")]))}`;
}

describe("immutable PR-002 verifier artifact seam", () => {
  it("pins the accepted draft.4 source and public vectors", () => {
    expect(COMMERCE_VERIFIER_METADATA).toEqual({
      protocolVersion: "0.1.0-draft.4",
      wireVersion: "0.1",
      sourceDigest:
        "sha256:0069b449f4b0f2f2ae88103219a182703498231b3e7cbe6d76cdd7e3f195ff27",
      jwsVectorDigest:
        "sha256:dc02568cb014cb46cdc984a38e987ffa1c9cfc05ddcb018c604d624a479ef6f9",
      eip712VectorDigest:
        "sha256:fbd11abda83fcbc214808e3506a33001fab2d4193faee96245d0e27182cb9e6d",
      artifactBundleDigest:
        "sha256:f5d1ea24047de1ac5bc325137b68fa6cc166a03728a0ae6214d1f2424c2cc0e7",
      artifactManifestDigest:
        "sha256:717fcc6c3fe26a5e8c1ba45746c67fdee5199c2a93fb860de8aab41e22c1e95e",
      bootCaptureDelayMaxMs: 1_000,
      bootVectorDigest:
        "sha256:210ec8cec947783a3258d4e04b97e93a411856711a2c2b0504923096a8038fc7",
      wrongSignerVectorDigest:
        "sha256:c74f0ec0c8ae1b398334fccb114aadc209a9b0758d2ef8d1d7b1074761d12070",
      conformanceCorpusDigest:
        "sha256:884e5b39f1da5871c400f974c2bca6c61e805101b9bd2abfad9aeb5d709bc589",
      conformanceReportDigest:
        "sha256:f17ff6db79340a323dc640aacceb0c251b9c03947cd605c4796e708239ef0b40",
    });
  });

  it("verifies exact bundle bytes and rejects missing, extra, or replaced artifacts", () => {
    const root = path.join(__dirname, "artifacts", "pr002");
    const manifest = new Uint8Array(readFileSync(path.join(root, "bundle-manifest.json")));
    const files = Object.fromEntries(
      readdirSync(root)
        .filter((file) => file !== "bundle-manifest.json")
        .sort()
        .map((file) => [file, new Uint8Array(readFileSync(path.join(root, file)))]),
    );
    expect(verifyCommerceVerifierBundle(manifest, files).reason).toBe("VERIFIED");
    const { [Object.keys(files)[0]!]: _missing, ...missing } = files;
    expect(verifyCommerceVerifierBundle(manifest, missing).reason).toBe(
      "ARTIFACT_INTEGRITY_FAILED",
    );
    expect(
      verifyCommerceVerifierBundle(manifest, { ...files, "../escape": new Uint8Array() }).reason,
    ).toBe("ARTIFACT_INTEGRITY_FAILED");
    const replaced = { ...files };
    replaced["jws-v1.json"] = Uint8Array.of(...replaced["jws-v1.json"]!);
    replaced["jws-v1.json"]![0] ^= 1;
    expect(verifyCommerceVerifierBundle(manifest, replaced).reason).toBe(
      "ARTIFACT_INTEGRITY_FAILED",
    );
  });
});

describe("offline detached JWS verification", () => {
  it.each(["es256", "eddsa"] as const)(
    "verifies accepted %s vectors and returns metadata only",
    async (fixtureName) => {
      const result = await verifyDetachedJwsLive({
        audience: jwsVector.audience,
        claims: jwsVector.statement,
        envelope: jwsVector[fixtureName],
        keyRegistry: keys,
        profile: jwsVector.statementProfile,
        requiredRole: "ISSUER",
        wireVersion: "0.1",
      });

      expect(result).toEqual({
        valid: true,
        claimsHash: jwsVector[fixtureName].signedObjectDigest,
        reason: "VERIFIED",
      });
      expect(Object.keys(result)).toEqual(["valid", "claimsHash", "reason"]);
    },
  );

  it("accepts a CUSTODY proof only through a CUSTODY registry entry", async () => {
    const custodyRegistry = keys.map((key, index) =>
      index === 0 ? { ...key, role: "CUSTODY" as const } : key,
    );
    const outcome = await verifyDetachedJwsLive({
      audience: jwsVector.audience,
      claims: jwsVector.statement,
      envelope: jwsVector.es256,
      keyRegistry: custodyRegistry,
      profile: jwsVector.statementProfile,
      requiredRole: "CUSTODY",
      wireVersion: "0.1",
    });
    expect(outcome.reason).toBe("VERIFIED");
  });

  it.each([
    ["wrong audience", { audience: "openant-commerce-verifier:wrong" }, "AUDIENCE_MISMATCH"],
    ["wrong role", { requiredRole: "CUSTODY" }, "KEY_ROLE_MISMATCH"],
    ["unknown key", { envelope: { ...jwsVector.es256, keyId: "key-unknown" } }, "KEY_ID_MISMATCH"],
    [
      "revoked key",
      {
        keyRegistry: keys.map((key, index) =>
          index === 0 ? { ...key, revokedAtUnixMs: 0 } : key,
        ),
      },
      "KEY_REVOKED",
    ],
    [
      "expired key",
      {
        keyRegistry: keys.map((key, index) =>
          index === 0 ? { ...key, notAfterUnixMs: 2_000 } : key,
        ),
      },
      "KEY_NOT_ACTIVE",
    ],
    [
      "corrupt signature",
      {
        envelope: {
          ...jwsVector.es256,
          signature: `${jwsVector.es256.signature.slice(0, -1)}A`,
        },
      },
      "SIGNATURE_INVALID",
    ],
  ])("rejects %s with a stable reason", async (_name, override, reason) => {
    const result = await verifyDetachedJwsLive({
      audience: jwsVector.audience,
      claims: jwsVector.statement,
      envelope: jwsVector.es256,
      keyRegistry: keys,
      profile: jwsVector.statementProfile,
      requiredRole: "ISSUER",
      wireVersion: "0.1",
      ...(override as object),
    });
    expect(result.reason).toBe(reason);
    expect(Object.keys(result)).toEqual(["valid", "claimsHash", "reason"]);
  });

  it("owns live time and only accepts bounded skew, with no caller backdate", async () => {
    expect(createCommerceVerifier({ maxClockSkewMs: 300_001 })).toEqual({
      valid: false,
      claimsHash: null,
      reason: "CLOCK_SKEW_INVALID",
    });
  });

  it("never admits a Boot key into the Commerce issuer registry", async () => {
    const bootRegistry = keys.map((key, index) =>
      index === 0 ? { ...key, role: "BOOT" as const } : key,
    );
    const outcome = await verifyDetachedJwsLive({
      audience: jwsVector.audience,
      claims: jwsVector.statement,
      envelope: jwsVector.es256,
      keyRegistry: bootRegistry,
      profile: jwsVector.statementProfile,
      requiredRole: "ISSUER",
      wireVersion: "0.1",
    });
    expect(outcome.reason).toBe("KEY_REGISTRY_INVALID");
  });

  it.each([
    ["embedded payload", `${jwsVector.es256.signature.split(".")[0]}.eA.${jwsVector.es256.signature.split(".")[2]}`, "MALFORMED_PROOF"],
    ["high-S ES256", highSJws(jwsVector.es256.signature), "SIGNATURE_NON_CANONICAL"],
    ["truncated ES256", `${jwsVector.es256.signature.slice(0, -8)}`, "SIGNATURE_ENCODING_INVALID"],
  ])("rejects %s JWS encoding", async (_case, signature, reason) => {
    const outcome = await verifyDetachedJwsLive({
      audience: jwsVector.audience,
      claims: jwsVector.statement,
      envelope: { ...jwsVector.es256, signature },
      keyRegistry: keys,
      profile: jwsVector.statementProfile,
      requiredRole: "ISSUER",
      wireVersion: "0.1",
    });
    expect(outcome.reason).toBe(reason);
  });

  it("rejects duplicate protected-header keys and owns an unavailable clock", async () => {
    const [_, empty, signature] = jwsVector.es256.signature.split(".");
    const duplicateHeader = base64url(
      new TextEncoder().encode(
        `{"alg":"ES256","alg":"ES256","aud":"${jwsVector.audience}","iss":"${jwsVector.es256.issuer}","kid":"${jwsVector.es256.keyId}","typ":"openant-commerce+jws"}`,
      ),
    );
    const duplicate = await verifyDetachedJwsLive({
      audience: jwsVector.audience,
      claims: jwsVector.statement,
      envelope: { ...jwsVector.es256, signature: `${duplicateHeader}.${empty}.${signature}` },
      keyRegistry: keys,
      profile: jwsVector.statementProfile,
      requiredRole: "ISSUER",
      wireVersion: "0.1",
    });
    expect(duplicate.reason).toBe("MALFORMED_PROOF");
    const clock = jest.spyOn(Date, "now").mockReturnValue(Number.NaN);
    await expect(
      verifyDetachedJwsLive({
        audience: jwsVector.audience,
        claims: jwsVector.statement,
        envelope: jwsVector.es256,
        keyRegistry: keys,
        profile: jwsVector.statementProfile,
        requiredRole: "ISSUER",
        wireVersion: "0.1",
      }),
    ).resolves.toMatchObject({ reason: "CLOCK_UNAVAILABLE", claimsHash: null });
    clock.mockRestore();
  });
});

describe("offline EIP-3009 and boot binding", () => {
  it("verifies the accepted Base USDC wallet vector", async () => {
    expect(
      await verifyEip3009Live({
        claimedClaimsHash: eip712Vector.claimsDigest,
        envelope: eip712Vector.envelope,
        typedData: eip712Vector.typedData,
        walletProofClaims: eip712Vector.walletProofClaims,
        wireVersion: "0.1",
      }),
    ).toEqual({
      valid: true,
      claimsHash: eip712Vector.claimsDigest,
      reason: "VERIFIED",
    });
  });

  it("rejects a corrupt wallet signature", async () => {
    const result = await verifyEip3009Live({
      claimedClaimsHash: eip712Vector.claimsDigest,
      envelope: {
        ...eip712Vector.envelope,
        signature: `0x9${eip712Vector.envelope.signature.slice(3)}`,
      },
      typedData: eip712Vector.typedData,
      walletProofClaims: eip712Vector.walletProofClaims,
      wireVersion: "0.1",
    });
    expect(result.reason).toBe("SIGNATURE_INVALID");
  });

  it("distinguishes a canonical signature from the wrong payer", async () => {
    const result = await verifyEip3009Live({
      claimedClaimsHash: eip712Vector.claimsDigest,
      envelope: { ...eip712Vector.envelope, signature: wrongSigner.signature },
      typedData: eip712Vector.typedData,
      walletProofClaims: eip712Vector.walletProofClaims,
      wireVersion: "0.1",
    });
    expect(result.reason).toBe("PAYER_ADDRESS_MISMATCH");
  });

  it("rejects a high-S wallet signature and caller-supplied message fields", async () => {
    const signature = eip712Vector.envelope.signature as string;
    const s = BigInt(`0x${signature.slice(66, 130)}`);
    const high = (SECP256K1_ORDER - s).toString(16).padStart(64, "0");
    const highS = await verifyEip3009Live({
      claimedClaimsHash: eip712Vector.claimsDigest,
      envelope: { ...eip712Vector.envelope, signature: `${signature.slice(0, 66)}${high}${signature.slice(130)}` },
      typedData: eip712Vector.typedData,
      walletProofClaims: eip712Vector.walletProofClaims,
      wireVersion: "0.1",
    });
    expect(highS.reason).toBe("SIGNATURE_NON_CANONICAL");
    const injected = await verifyEip3009Live({
      claimedClaimsHash: eip712Vector.claimsDigest,
      envelope: eip712Vector.envelope,
      typedData: { ...eip712Vector.typedData, message: { ...eip712Vector.typedData.message, callerDigest: `0x${"0".repeat(64)}` } },
      walletProofClaims: eip712Vector.walletProofClaims,
      wireVersion: "0.1",
    });
    expect(injected.reason).toBe("AUTHORIZATION_MESSAGE_MISMATCH");
  });

  it("composes but never conflates a previously verified BootProof", () => {
    const expected = {
      profile: "commerce-authorization/v1",
      appProofClaimsHash: `sha256:${"1".repeat(64)}`,
      bootProofHash: `sha256:${"2".repeat(64)}`,
      ephemeralKeyHash: `sha256:${"3".repeat(64)}`,
      pivotHash: `sha256:${"4".repeat(64)}`,
    } as const;
    expect(verifyBootBinding({ expected, verified: expected })).toEqual({
      valid: false,
      claimsHash: null,
      reason: "BOOT_BINDING_MISMATCH",
    });
    expect(
      verifyBootBinding({
        expected,
        verified: { ...expected, pivotHash: `sha256:${"0".repeat(64)}` },
      }).reason,
    ).toBe("BOOT_BINDING_MISMATCH");
  });

  it("verifies the fixed real Boot/AppProof vector but never promotes its non-Commerce profile", async () => {
    const anchor = bootVector.anchor as QuorumManifestSetAnchor;
    await expect(
      verifyWithBootEnvelope(
        bootVector.appProof as never,
        bootVector.bootProof as never,
        anchor,
      ),
    ).resolves.toBeDefined();
    await expect(
      verifyCommerceBootProjection(
        bootVector.appProof as never,
        bootVector.bootProof as never,
        `sha256:${"1".repeat(64)}`,
        anchor,
      ),
    ).rejects.toMatchObject({
      name: "CommerceBootVerificationError",
      reason: "BOOT_BINDING_MISMATCH",
    });
  });

  it.each([
    ["capture time", { createdAt: { ...bootVector.bootProof.createdAt, seconds: String(Number(bootVector.bootProof.createdAt.seconds) + 2) } }, bootVector.anchor],
    ["attestation/certificate chain", { awsAttestationDocB64: mutateBase64(bootVector.bootProof.awsAttestationDocB64) }, bootVector.anchor],
    ["manifest/pivot", { qosManifestB64: mutateBase64(bootVector.bootProof.qosManifestB64) }, bootVector.anchor],
    ["manifest envelope", { qosManifestEnvelopeB64: mutateBase64(bootVector.bootProof.qosManifestEnvelopeB64) }, bootVector.anchor],
    ["ephemeral key", { ephemeralPublicKeyHex: `${bootVector.bootProof.ephemeralPublicKeyHex.slice(0, -1)}0` }, bootVector.anchor],
    ["pinned member", {}, { ...bootVector.anchor, members: [{ ...bootVector.anchor.members[0]!, pubKeyHex: `${bootVector.anchor.members[0]!.pubKeyHex.slice(0, -1)}0` }, bootVector.anchor.members[1]!] }],
    ["pinned quorum", {}, { ...bootVector.anchor, quorumKeyHex: `${bootVector.anchor.quorumKeyHex.slice(0, -1)}0` }],
  ])("fails closed when %s is tampered", async (_case, bootOverride, anchorOverride) => {
    const failure = await verifyCommerceBootProjection(
        bootVector.appProof as never,
        { ...bootVector.bootProof, ...bootOverride } as never,
        `sha256:${"1".repeat(64)}`,
        anchorOverride as QuorumManifestSetAnchor,
      ).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(CommerceBootVerificationError);
    expect(failure).toMatchObject({ reason: "BOOT_BINDING_MISMATCH" });
  });

  it("returns the same stable reason for a non-canonical claims hash", async () => {
    await expect(
      verifyCommerceBootProjection(
        bootVector.appProof as never,
        bootVector.bootProof as never,
        "sha256:BAD" as never,
        bootVector.anchor as QuorumManifestSetAnchor,
      ),
    ).rejects.toMatchObject({ reason: "BOOT_BINDING_MISMATCH" });
  });
});
