import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha2";

import {
  isVerifiedCommerceBootProjection,
  verifyCommerceSignature,
} from "../commerce-verifier";
import { projectAuthenticatedCommerceAppProof } from "../commerce-verifier.internal";

const text = new TextEncoder();

describe("Commerce signature primitive", () => {
  it("fails closed without importing private or mislabeled keys", () => {
    expect(
      verifyCommerceSignature(
        "EdDSA",
        {
          kty: "OKP",
          crv: "Ed25519",
          use: "sig",
          key_ops: ["verify"],
          x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
          d: "private",
        },
        text.encode("statement"),
        new Uint8Array(64),
      ),
    ).toBe("KEY_INVALID");
  });

  it("privately verifies a deterministic Commerce session before projection", () => {
    const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 7 : 0);
    const sessionKey = p256.getPublicKey(privateKey, false);
    const publicKey = Uint8Array.of(...sessionKey, ...sessionKey);
    const publicKeyHex = Buffer.from(publicKey).toString("hex");
    const claimsHash = `sha256:${"4".repeat(64)}` as const;
    const proofPayload = JSON.stringify({
      claimsHash,
      profile: "commerce-authorization/v1",
    });
    const signature = p256.sign(sha256(text.encode(proofPayload)), privateKey).toCompactHex();
    const ephemeralKeyHash = `sha256:${Buffer.from(sha256(publicKey)).toString("hex")}` as const;
    const projection = projectAuthenticatedCommerceAppProof(
      {
        scheme: "SIGNATURE_SCHEME_EPHEMERAL_KEY_P256",
        publicKey: publicKeyHex,
        proofPayload,
        signature,
      },
      claimsHash,
      {
        bootProofHash: `sha256:${"1".repeat(64)}`,
        ephemeralKeyHash,
        pivotHash: `sha256:${"2".repeat(64)}`,
      },
    );
    expect(projection.appProofClaimsHash).toBe(claimsHash);
    expect(isVerifiedCommerceBootProjection(projection)).toBe(false);
    expect(() => projectAuthenticatedCommerceAppProof(
      { ...{
        scheme: "SIGNATURE_SCHEME_EPHEMERAL_KEY_P256" as const,
        publicKey: publicKeyHex,
        proofPayload,
        signature,
      }, proofPayload: proofPayload.replace("commerce-authorization/v1", "other/v1") },
      claimsHash,
      projection,
    )).toThrow();
  });
});
