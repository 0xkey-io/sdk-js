import { createPublicKey, verify } from "node:crypto";
import { createXStampV2Stamper, xStampV2Canonical } from "./xstamp";

const P256_GENERATOR_PUBLIC_KEY = createPublicKey({
  format: "jwk",
  key: {
    kty: "EC", crv: "P-256",
    x: Buffer.from("6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296", "hex").toString("base64url"),
    y: Buffer.from("4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5", "hex").toString("base64url"),
  },
});

test.each(["lowercase", "uppercase"])("valid %s P-256 keys retain their encoding and sign X-Stamp V2", async (encoding) => {
  const key = {
    publicKey: "036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
    privateKey: "0000000000000000000000000000000000000000000000000000000000000001",
  };
  if (encoding === "uppercase") {
    key.publicKey = key.publicKey.toUpperCase();
    key.privateKey = key.privateKey.toUpperCase();
  }
  Object.freeze(key);
  const before = { ...key };
  const stamper = createXStampV2Stamper(key);
  const result = await stamper.stampRequest({
    method: "post",
    url: "https://pay.example/v1/payments/%E2%9C%93?z=a%20b&a=2&a=1",
    body: '{"amount":"100000"}',
    organizationId: "11111111-1111-1111-1111-111111111111",
    wireProtocol: "mpp",
  });
  const stamp = JSON.parse(Buffer.from(result.stampHeaderValue, "base64url").toString());
  expect(result.stampHeaderName).toBe("X-Stamp");
  expect(stamp).toMatchObject({
    version: "2", publicKey: key.publicKey, scheme: "SIGNATURE_SCHEME_TK_API_P256",
    organizationId: "11111111-1111-1111-1111-111111111111", wireProtocol: "mpp",
  });
  expect(stamp.nonce).toMatch(/^[a-f0-9]{32}$/);
  expect(Number.isSafeInteger(stamp.timestampMs)).toBe(true);
  const canonical = [
    "2", "POST", "/v1/payments/%E2%9C%93", "a=1&a=2&z=a%20b",
    String(stamp.timestampMs), stamp.nonce,
    "43f3231149d679dc1a2f5568b46300eebce9f192db2aa06dd332bd3938675274",
    "11111111-1111-1111-1111-111111111111", "mpp",
  ].join("\n");
  expect(verify("sha256", Buffer.from(canonical), P256_GENERATOR_PUBLIC_KEY, Buffer.from(stamp.signature, "hex"))).toBe(true);
  expect(key).toEqual(before);
  expect(stamp.privateKey).toBeUndefined();
});

test("X-Stamp keeps the validated key pair when the caller mutates its object", async () => {
  const key = {
    publicKey: "036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
    privateKey: "0000000000000000000000000000000000000000000000000000000000000001",
  };
  const validatedPublicKey = key.publicKey;
  const stamper = createXStampV2Stamper(key);
  key.publicKey = `02${key.publicKey.slice(2)}`;
  key.privateKey = "00".repeat(32);
  const input = {
    method: "GET", url: "https://pay.example/supported", body: "",
    organizationId: "11111111-1111-1111-1111-111111111111", wireProtocol: "x402" as const,
  };
  const result = await stamper.stampRequest(input);
  const stamp = JSON.parse(Buffer.from(result.stampHeaderValue, "base64url").toString());
  expect(stamp.publicKey).toBe(validatedPublicKey);
  const canonical = await xStampV2Canonical({ ...input, nonce: stamp.nonce, timestampMs: stamp.timestampMs });
  expect(verify("sha256", Buffer.from(canonical), P256_GENERATOR_PUBLIC_KEY, Buffer.from(stamp.signature, "hex"))).toBe(true);
  expect(key.privateKey).toBe("00".repeat(32));
  expect(key.publicKey).toBe(`02${validatedPublicKey.slice(2)}`);
});

const GOLDEN_CANONICAL = [
  "2",
  "POST",
  "/v1/payments/%E2%9C%93",
  "a=1&a=2&z=a%20b",
  "1723456789000",
  "0123456789abcdef0123456789abcdef",
  "43f3231149d679dc1a2f5568b46300eebce9f192db2aa06dd332bd3938675274",
  "11111111-1111-1111-1111-111111111111",
  "mpp",
].join("\n");

test("X-Stamp V2 canonical form matches the Go gateway golden vector", async () => {
  await expect(
    xStampV2Canonical({
      method: "post",
      url: "https://pay.example/v1/payments/%E2%9C%93?z=a%20b&a=2&a=1",
      body: '{"amount":"100000"}',
      organizationId: "11111111-1111-1111-1111-111111111111",
      wireProtocol: "mpp",
      timestampMs: 1_723_456_789_000,
      nonce: "0123456789abcdef0123456789abcdef",
    }),
  ).resolves.toBe(GOLDEN_CANONICAL);
});

test("X-Stamp V2 query encoding is RFC 3986 and cross-language stable", async () => {
  const canonical = await xStampV2Canonical({
    method: "GET",
    url: "https://pay.example/read?unicode=%E2%9C%93&sym=~!*%27()&plus=a+b",
    body: "",
    organizationId: "11111111-1111-1111-1111-111111111111",
    wireProtocol: "admin",
    timestampMs: 1_723_456_789_000,
    nonce: "0123456789abcdef0123456789abcdef",
  });
  expect(canonical.split("\n")[3]).toBe(
    "plus=a%20b&sym=~%21%2A%27%28%29&unicode=%E2%9C%93",
  );
});
