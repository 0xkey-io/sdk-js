export type ChargeSettlementProtocolId =
  | "x402-exact-v2-eip3009"
  | "mpp-evm-charge-v0";

export interface ChargeSettlementCommand {
  protocolId: ChargeSettlementProtocolId;
  adapterRevision: "x402-exact-v2" | "mpp-evm-charge-v0";
  network: "eip155:8453" | "eip155:84532";
  asset: `0x${string}`;
  amount: string;
  payer: `0x${string}`;
  payTo: `0x${string}`;
  authorization: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
    nonce: `0x${string}`;
    validAfter: string;
    validBefore: string;
    signature: `0x${string}`;
  };
}
