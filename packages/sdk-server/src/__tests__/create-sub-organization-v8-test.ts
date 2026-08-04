import { afterEach, expect, jest, test } from "@jest/globals";

import { readFixture } from "../__fixtures__/shared";
import { ZeroXKey } from "../index";

afterEach(() => {
  jest.restoreAllMocks();
});

test("createSubOrganization sends and flattens the current V8 contract", async () => {
  const { privateKey, publicKey } = await readFixture();
  const client = new ZeroXKey({
    apiBaseUrl: "https://mocked.0xkey.com",
    apiPrivateKey: privateKey,
    apiPublicKey: publicKey,
    defaultOrganizationId: "89881fc7-6ff3-4b43-b962-916698f8ff58",
  });

  const mockedFetch = jest.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      activity: {
        id: "activity-v8",
        status: "ACTIVITY_STATUS_COMPLETED",
        type: "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8",
        result: {
          createSubOrganizationResultV8: {
            subOrganizationId: "sub-org-v8",
            rootUserIds: ["root-user-v8"],
          },
        },
      },
    }),
  } as Response);

  const response = await client.apiClient().createSubOrganization({
    subOrganizationName: "tenant-v8",
    rootUsers: [
      {
        userName: "root-user",
        apiKeys: [],
        authenticators: [],
        oauthProviders: [],
      },
    ],
    rootQuorumThreshold: 1,
  });

  const requestBody = JSON.parse(
    String(mockedFetch.mock.lastCall?.[1]?.body),
  ) as { type: string };

  expect(requestBody.type).toBe("ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8");
  expect(response.subOrganizationId).toBe("sub-org-v8");
  expect(response.rootUserIds).toEqual(["root-user-v8"]);
});

test("createSubOrganization tolerates a newer versioned result key", async () => {
  const { privateKey, publicKey } = await readFixture();
  const client = new ZeroXKey({
    apiBaseUrl: "https://mocked.0xkey.com",
    apiPrivateKey: privateKey,
    apiPublicKey: publicKey,
    defaultOrganizationId: "89881fc7-6ff3-4b43-b962-916698f8ff58",
  });

  jest.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      activity: {
        id: "activity-v9",
        status: "ACTIVITY_STATUS_COMPLETED",
        type: "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V9",
        result: {
          createSubOrganizationResultV9: {
            subOrganizationId: "sub-org-v9",
            rootUserIds: ["root-user-v9"],
          },
        },
      },
    }),
  } as Response);

  const response = await client.apiClient().createSubOrganization({
    subOrganizationName: "tenant-v9",
    rootUsers: [
      {
        userName: "root-user",
        apiKeys: [],
        authenticators: [],
        oauthProviders: [],
      },
    ],
    rootQuorumThreshold: 1,
  });

  expect(response.subOrganizationId).toBe("sub-org-v9");
  expect(response.rootUserIds).toEqual(["root-user-v9"]);
});
