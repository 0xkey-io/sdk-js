import { test, expect, describe } from "@jest/globals";
import { ed25519 } from "@noble/curves/ed25519";
import {
  buildSignedInput,
  verifyWebhook,
  verifyWebhookFromJWKS,
  ZeroXKeyWebhookVerificationFailureReasons,
} from "../webhooks";

/** Fixed fixture shared with Rust `webhook-contract` sign_delivery (seed = [1u8; 32]). */
const GOLDEN = {
  publicKey: "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=",
  keyId: "golden-key-001",
  eventId: "evt-golden-001",
  timestampMs: "1718000000000",
  body: '{"eventId":"evt-golden-001","eventType":"activity.completed"}',
  signature:
    "44f8c614799b8678f2efc643a1c37c1d329142da16368b4b4b413912d72d6c5477dfb86a4f1a5c475588f86d31d761daeb6668f5ea62f0eac91c52baac48d10a",
};

function goldenHeaders(overrides: Record<string, string> = {}) {
  return {
    "x-0xkey-organization-id": "org-golden",
    "x-0xkey-event-type": "activity.completed",
    "x-0xkey-timestamp": GOLDEN.timestampMs,
    "x-0xkey-signature-version": "v1",
    "x-0xkey-event-id": GOLDEN.eventId,
    "x-0xkey-signature-key-id": GOLDEN.keyId,
    "x-0xkey-signature-algorithm": "ed25519",
    "x-0xkey-signature": GOLDEN.signature,
    ...overrides,
  };
}

describe("webhook verification", () => {
  test("buildSignedInput matches Rust webhook-contract prefix format", () => {
    const prefix = "v1.ed25519.golden-key-001.1718000000000.evt-golden-001.";
    const bytes = buildSignedInput({
      version: "v1",
      algorithm: "ed25519",
      keyId: GOLDEN.keyId,
      timestampMs: GOLDEN.timestampMs,
      eventId: GOLDEN.eventId,
      body: GOLDEN.body,
    });
    expect(new TextDecoder().decode(bytes.slice(0, prefix.length))).toBe(
      prefix,
    );
    expect(new TextDecoder().decode(bytes.slice(prefix.length))).toBe(
      GOLDEN.body,
    );
  });

  test("verifyWebhook accepts Rust webhook-contract golden vector", () => {
    const result = verifyWebhook({
      headers: goldenHeaders(),
      body: GOLDEN.body,
      verificationKeys: [{ keyId: GOLDEN.keyId, publicKey: GOLDEN.publicKey }],
      maxTimestampAgeMs: 0,
      nowMs: Number(GOLDEN.timestampMs),
    });

    expect(result).toEqual({
      ok: true,
      eventId: GOLDEN.eventId,
      keyId: GOLDEN.keyId,
      timestampMs: Number(GOLDEN.timestampMs),
    });
  });

  test("verifyWebhook round-trip with locally signed delivery", () => {
    const privateKey = ed25519.utils.randomPrivateKey();
    const publicKeyBytes = ed25519.getPublicKey(privateKey);
    const publicKey = Buffer.from(publicKeyBytes).toString("base64");
    const keyId = "local-test-key";
    const eventId = "evt-local-001";
    const timestampMs = "1718000000123";
    const body = '{"eventType":"activity.failed"}';

    const signedInput = buildSignedInput({
      version: "v1",
      algorithm: "ed25519",
      keyId,
      timestampMs,
      eventId,
      body,
    });
    const signature = Buffer.from(
      ed25519.sign(signedInput, privateKey),
    ).toString("hex");

    const result = verifyWebhook({
      headers: {
        "x-0xkey-timestamp": timestampMs,
        "x-0xkey-event-id": eventId,
        "x-0xkey-signature-key-id": keyId,
        "x-0xkey-signature-algorithm": "ed25519",
        "x-0xkey-signature-version": "v1",
        "x-0xkey-signature": signature,
      },
      body,
      verificationKeys: [{ keyId, publicKey }],
      maxTimestampAgeMs: 60_000,
      nowMs: Number(timestampMs),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.eventId).toBe(eventId);
      expect(result.keyId).toBe(keyId);
    }
  });

  test("verifyWebhook rejects tampered body", () => {
    const result = verifyWebhook({
      headers: goldenHeaders(),
      body: GOLDEN.body + " ",
      verificationKeys: [{ keyId: GOLDEN.keyId, publicKey: GOLDEN.publicKey }],
      maxTimestampAgeMs: 0,
      nowMs: Number(GOLDEN.timestampMs),
    });

    expect(result).toEqual({
      ok: false,
      reason: ZeroXKeyWebhookVerificationFailureReasons.InvalidSignature,
    });
  });

  test("verifyWebhookFromJWKS fetches key and verifies", async () => {
    const fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          keys: [
            {
              kid: GOLDEN.keyId,
              kty: "OKP",
              crv: "Ed25519",
              alg: "EdDSA",
              use: "sig",
              x: GOLDEN.publicKey,
            },
          ],
        }),
      }) as Response;

    const result = await verifyWebhookFromJWKS({
      headers: goldenHeaders(),
      body: GOLDEN.body,
      jwksUrl: "https://gateway.test/v1/webhook-jwks",
      maxTimestampAgeMs: 0,
      nowMs: Number(GOLDEN.timestampMs),
      fetch,
    });

    expect(result.ok).toBe(true);
  });
});
