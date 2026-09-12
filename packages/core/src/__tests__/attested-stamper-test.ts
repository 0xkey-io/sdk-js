import { expect, jest, test } from "@jest/globals";
import type { AttestedStamper } from "@0xkey-io/attested-stamper";
import { AttestedScheme } from "@0xkey-io/attested-stamper";
import { ZeroXKeyClient } from "../__clients__/core";

function clientWith(stamper: AttestedStamper) {
  return new ZeroXKeyClient(
    { organizationId: "org-1" },
    undefined,
    undefined,
    undefined,
    stamper,
  );
}

test("overrideAttestedStamper configures exactly one identity scheme", async () => {
  const configure = jest.fn();
  const clear = jest.fn();
  const client = clientWith({ configure, clear } as unknown as AttestedStamper);

  await client.overrideAttestedStamper({
    verificationToken: "verification-token",
    publicKey: "public-key",
  });
  expect(configure).toHaveBeenCalledWith({
    attestedIdentity: "verification-token",
    publicKey: "public-key",
    scheme: AttestedScheme.P256_VERIFICATION_TOKEN,
  });

  await client.overrideAttestedStamper({
    oidcToken: "oidc-token",
    publicKey: "public-key",
  });
  expect(configure).toHaveBeenLastCalledWith({
    attestedIdentity: "oidc-token",
    publicKey: "public-key",
    scheme: AttestedScheme.P256_OIDC,
  });

  await client.overrideAttestedStamper({});
  expect(clear).toHaveBeenCalledTimes(1);
});

test("overrideAttestedStamper rejects ambiguous or unbound identity", async () => {
  const client = clientWith({
    configure: jest.fn(),
    clear: jest.fn(),
  } as unknown as AttestedStamper);

  await expect(
    client.overrideAttestedStamper({
      verificationToken: "verification-token",
      oidcToken: "oidc-token",
      publicKey: "public-key",
    }),
  ).rejects.toThrow("Cannot set both");
  await expect(
    client.overrideAttestedStamper({ verificationToken: "verification-token" }),
  ).rejects.toThrow("publicKey");
});

test("setMfaHandler updates future HTTP clients and can clear the handler", () => {
  const client = clientWith({
    configure: jest.fn(),
    clear: jest.fn(),
  } as unknown as AttestedStamper);
  const handler = jest.fn(async () => undefined);
  client.setMfaHandler(handler);
  expect(client.createHttpClient().config.onMfaRequired).toBe(handler);
  client.setMfaHandler(undefined);
  expect(client.createHttpClient().config.onMfaRequired).toBeUndefined();
});
