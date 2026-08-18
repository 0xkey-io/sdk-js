import { xStampV2Canonical } from "./xstamp";

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
