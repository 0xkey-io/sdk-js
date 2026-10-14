import { describe, expect, jest, test } from "@jest/globals";
import { createReadyClient } from "./test-support/ready-client";

describe("addPasskey default name", () => {
  test("names new passkeys after the canonical 0xkey brand", async () => {
    const client = await createReadyClient();
    const createPasskey = jest.fn(async (_params: { name?: string }) => ({
      encodedChallenge: "challenge",
      attestation: { credentialId: "credential" },
    }));
    const createAuthenticators = jest.fn(
      async (_body: {
        authenticators: Array<{ authenticatorName: string }>;
      }) => ({
        authenticatorIds: ["authenticator-1"],
      }),
    );
    Object.assign(client, {
      createPasskey,
      httpClient: { createAuthenticators },
      storageManager: {
        getActiveSession: async () => ({
          userId: "user-1",
          organizationId: "org-1",
        }),
      },
    });

    await client.addPasskey({ userId: "user-1" });

    const name = createPasskey.mock.calls[0]![0].name!;
    expect(name).toMatch(/^0xkey Passkey-\d+$/);
    expect(
      createAuthenticators.mock.calls[0]![0].authenticators[0]!
        .authenticatorName,
    ).toBe(name);
  });
});
