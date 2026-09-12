import { p256 } from "@noble/curves/p256";
import { AttestedScheme, AttestedStamper } from "./attested-stamper";
import vector from "../../../internal/contract-guard/vectors/turnkey-attested-stamp.json";

const body = vector.bodyUtf8;
const highDer = vector.highDerHex;

test("emits Turnkey-compatible unpadded X-Stamp-Attested JSON", async () => {
  const signer = { sign: jest.fn().mockResolvedValue(highDer) };
  const stamper = new AttestedStamper(signer);
  stamper.configure({
    attestedIdentity: "verification-token",
    publicKey: "045ef9",
    scheme: AttestedScheme.P256_VERIFICATION_TOKEN,
  });

  const stamp = await stamper.stamp(body);
  expect(stamp.stampHeaderName).toBe(vector.header);
  expect(stamp.stampHeaderValue).not.toMatch(/[+=/]/);
  expect(
    JSON.parse(Buffer.from(stamp.stampHeaderValue, "base64url").toString()),
  ).toEqual({
    publicKeyAttestation: "verification-token",
    scheme: "STAMP_ATTESTED_SCHEME_P256_VERIFICATION_TOKEN",
    publicKey: "045ef9",
    signature: vector.lowDerHex,
  });
  expect(signer.sign).toHaveBeenCalledWith(body, "der", "045ef9");
});

test("signs the exact payload bytes and supports OIDC", async () => {
  const signer = { sign: jest.fn().mockResolvedValue(highDer) };
  const stamper = new AttestedStamper(signer);
  stamper.configure({
    attestedIdentity: "oidc-token",
    publicKey: "045ef9",
    scheme: AttestedScheme.P256_OIDC,
  });

  await stamper.stamp(`${body} `);
  expect(signer.sign).toHaveBeenCalledWith(`${body} `, "der", "045ef9");
});

test("fails closed when identity or public key is missing and clear removes both", async () => {
  const stamper = new AttestedStamper({
    sign: jest.fn().mockResolvedValue(highDer),
  });
  await expect(stamper.stamp(body)).rejects.toThrow(
    "Attested identity not set",
  );

  stamper.configure({
    attestedIdentity: "verification-token",
    publicKey: "045ef9",
    scheme: AttestedScheme.P256_VERIFICATION_TOKEN,
  });
  stamper.clear();
  await expect(stamper.stamp(body)).rejects.toThrow(
    "Attested identity not set",
  );
});
