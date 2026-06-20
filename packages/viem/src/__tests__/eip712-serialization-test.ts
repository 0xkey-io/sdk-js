import { serializeTypedData } from "viem";
import { describe, expect, test } from "@jest/globals";

import { __serializeTypedDataForZeroXKey } from "../";

describe("EIP-712 serialization", () => {
  test("preserves the domain when EIP712Domain is omitted by the caller", () => {
    const typedData = {
      domain: {
        name: "USDC",
        version: "2",
        chainId: 84532,
        verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: "0x5d668a301F28C07B310c2E6F595791F77072bE8B",
        to: "0xfB65e93108ac2bA9a5e7A997F8080b40eA551104",
        value: 1n,
        validAfter: 1781771299n,
        validBefore: 1781771659n,
        nonce:
          "0x93393c8c080f5ae17fce80d6e2dd2863a1ed6ca5dd22ac0588747ced8d89039a",
      },
    } as const;

    const viemSerialized = JSON.parse(serializeTypedData(typedData));
    const zeroXKeySerialized = JSON.parse(
      __serializeTypedDataForZeroXKey(typedData),
    );

    expect(viemSerialized.domain).toEqual({});
    expect(zeroXKeySerialized.domain).toEqual({
      name: "USDC",
      version: "2",
      chainId: 84532,
      verifyingContract: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    });
    expect(zeroXKeySerialized.types.EIP712Domain).toEqual([
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ]);
  });
});
