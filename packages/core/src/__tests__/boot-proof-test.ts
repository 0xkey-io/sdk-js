import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ZeroXKeyErrorCodes } from "@0xkey-io/sdk-types";
import type { v1BootProof } from "@0xkey-io/sdk-types";
import type { ParsedManifestEnvelope } from "@0xkey-io/crypto";

jest.mock(
  "@polyfills/window",
  () => ({
    __esModule: true,
    default: {
      localStorage: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
    },
  }),
  { virtual: true },
);
jest.mock(
  "@utils",
  () => ({
    __esModule: true,
    parseSession: jest.fn(),
  }),
  { virtual: true },
);

jest.mock("@0xkey-io/crypto", () => ({
  verifyBootProof: jest.fn(),
}));

import { ZeroXKeyClient } from "../__clients__/core";
import { StamperType } from "../__types__";
import { verifyBootProof } from "@0xkey-io/crypto";

const mockVerifyBootProof = jest.mocked(verifyBootProof);

const fakeBootProof: v1BootProof = {
  ephemeralPublicKeyHex: "04" + "ab".repeat(64),
  awsAttestationDocB64: "ZmFrZQ==",
  qosManifestB64: "ZmFrZQ==",
  qosManifestEnvelopeB64: "ZmFrZQ==",
  deploymentLabel: "prod-20260630",
  enclaveApp: "signer",
  owner: "0xkey",
  createdAt: { seconds: "1758057949", nanos: "436158000" },
};

function createClientWithGetLatestBootProof(
  impl: (...args: any[]) => Promise<any>,
): ZeroXKeyClient {
  const client = new ZeroXKeyClient({ organizationId: "org-id" });

  (client as any).storageManager = {
    getActiveSession: async () => undefined,
  };
  (client as any).httpClient = {
    getLatestBootProof: impl,
  };

  return client;
}

describe("fetchLatestBootProof", () => {
  it("returns the boot proof for a valid app name", async () => {
    const getLatestBootProof = jest.fn(async () => ({
      bootProof: fakeBootProof,
    }));
    const client = createClientWithGetLatestBootProof(getLatestBootProof);

    const result = await client.fetchLatestBootProof({
      appName: "signer",
      organizationId: "org-id",
      stampWith: StamperType.Passkey,
    });

    expect(result).toEqual(fakeBootProof);
    expect(getLatestBootProof).toHaveBeenCalledWith(
      { organizationId: "org-id", appName: "signer" },
      StamperType.Passkey,
    );
  });

  it("throws a ZeroXKeyError when appName is missing", async () => {
    const client = createClientWithGetLatestBootProof(async () => ({
      bootProof: fakeBootProof,
    }));

    await expect(
      client.fetchLatestBootProof({
        appName: "",
        organizationId: "org-id",
        stampWith: StamperType.Passkey,
      }),
    ).rejects.toMatchObject({
      name: "ZeroXKeyError",
      code: ZeroXKeyErrorCodes.INVALID_REQUEST,
    });
  });

  it("throws a ZeroXKeyError when the response has no boot proof", async () => {
    const client = createClientWithGetLatestBootProof(async () => ({}));

    await expect(
      client.fetchLatestBootProof({
        appName: "signer",
        organizationId: "org-id",
        stampWith: StamperType.Passkey,
      }),
    ).rejects.toMatchObject({
      name: "ZeroXKeyError",
      code: ZeroXKeyErrorCodes.BAD_RESPONSE,
    });
  });
});

describe("verifyLatestBootProof", () => {
  beforeEach(() => {
    mockVerifyBootProof.mockReset();
  });

  it("fetches the latest boot proof and delegates verification to @0xkey-io/crypto's verifyBootProof", async () => {
    const parsedEnvelope: ParsedManifestEnvelope = {
      version: "v1",
      manifest: {
        version: "v1",
        namespace: { name: "prod/signer", nonce: 1, quorumKeyHex: "04" },
        pivotHashHex: "ab".repeat(32),
        manifestSet: { threshold: 1, members: [] },
        enclave: {
          pcr0Hex: "",
          pcr1Hex: "",
          pcr2Hex: "",
          pcr3Hex: "",
        },
      },
      manifestSetApprovals: [],
      manifestHashHex: "cd".repeat(32),
    };
    mockVerifyBootProof.mockResolvedValue(parsedEnvelope);

    const getLatestBootProof = jest.fn(async () => ({
      bootProof: fakeBootProof,
    }));
    const client = createClientWithGetLatestBootProof(getLatestBootProof);

    const anchor = { threshold: 1, members: [] };
    const result = await client.verifyLatestBootProof({
      appName: "signer",
      organizationId: "org-id",
      stampWith: StamperType.Passkey,
      anchor,
    });

    expect(result).toBe(parsedEnvelope);
    expect(mockVerifyBootProof).toHaveBeenCalledWith(fakeBootProof, anchor);
  });

  it("wraps verifyBootProof failures in a ZeroXKeyError", async () => {
    mockVerifyBootProof.mockRejectedValue(
      new Error("Insufficient quorum approvals: got 1, need 2"),
    );

    const getLatestBootProof = jest.fn(async () => ({
      bootProof: fakeBootProof,
    }));
    const client = createClientWithGetLatestBootProof(getLatestBootProof);

    await expect(
      client.verifyLatestBootProof({
        appName: "signer",
        organizationId: "org-id",
        stampWith: StamperType.Passkey,
      }),
    ).rejects.toMatchObject({
      name: "ZeroXKeyError",
      code: ZeroXKeyErrorCodes.VERIFY_LATEST_BOOT_PROOF_ERROR,
    });
  });

  it("propagates the original fetch error code without calling verifyBootProof", async () => {
    // withZeroXKeyErrorHandling preserves an already-ZeroXKeyError's own
    // code/message rather than re-wrapping it, so a missing-boot-proof fetch
    // failure surfaces as BAD_RESPONSE, not VERIFY_LATEST_BOOT_PROOF_ERROR.
    const client = createClientWithGetLatestBootProof(async () => ({}));

    await expect(
      client.verifyLatestBootProof({
        appName: "signer",
        organizationId: "org-id",
        stampWith: StamperType.Passkey,
      }),
    ).rejects.toMatchObject({
      code: ZeroXKeyErrorCodes.BAD_RESPONSE,
    });
    expect(mockVerifyBootProof).not.toHaveBeenCalled();
  });
});
