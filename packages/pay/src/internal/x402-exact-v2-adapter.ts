import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { getAddress } from "viem";
import type { BasePaymentNetwork } from "../receipt-verifier";
import type { ChargeSettlementCommand } from "./charge-settlement-command";

const ASSET_BY_NETWORK = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;

export class X402ExactV2Adapter {
  constructor(private readonly network: BasePaymentNetwork) {}

  toCommand(
    paymentPayload: PaymentPayload,
    requirements: PaymentRequirements,
  ): ChargeSettlementCommand {
    const envelope = paymentPayload.payload;
    if (!isRecord(envelope) || !isRecord(envelope.authorization)) {
      throw invalidChallenge();
    }
    const authorization = envelope.authorization;
    if (
      paymentPayload.x402Version !== 2 ||
      requirements.scheme !== "exact" ||
      requirements.network !== this.network ||
      paymentPayload.accepted.network !== this.network ||
      getAddress(requirements.asset) !== getAddress(ASSET_BY_NETWORK[this.network]) ||
      getAddress(paymentPayload.accepted.asset) !== getAddress(requirements.asset) ||
      paymentPayload.accepted.amount !== requirements.amount ||
      getAddress(paymentPayload.accepted.payTo) !== getAddress(requirements.payTo) ||
      typeof authorization.to !== "string" ||
      getAddress(authorization.to) !== getAddress(requirements.payTo) ||
      typeof authorization.value !== "string" ||
      authorization.value !== requirements.amount ||
      requirements.extra?.assetTransferMethod !== "eip3009" ||
      requirements.extra?.paymentFlow !== "upfront"
    ) {
      throw invalidChallenge();
    }
    const allowedExtra = new Set([
      "assetTransferMethod",
      "name",
      "paymentFlow",
      "version",
    ]);
    if (Object.keys(requirements.extra ?? {}).some((key) => !allowedExtra.has(key))) {
      throw invalidChallenge();
    }
    const name = requirements.extra?.name;
    const version = requirements.extra?.version;
    if (
      typeof name !== "string" ||
      typeof version !== "string" ||
      typeof authorization.from !== "string" ||
      typeof authorization.nonce !== "string" ||
      typeof authorization.validAfter !== "string" ||
      typeof authorization.validBefore !== "string" ||
      typeof envelope.signature !== "string"
    ) {
      throw invalidChallenge();
    }
    return {
      protocolId: "x402-exact-v2-eip3009",
      adapterRevision: "x402-exact-v2",
      network: this.network,
      asset: requirements.asset as `0x${string}`,
      amount: requirements.amount,
      payer: authorization.from as `0x${string}`,
      payTo: requirements.payTo as `0x${string}`,
      authorization: {
        domain: {
          name,
          version,
          chainId: this.network === "eip155:8453" ? 8453 : 84532,
          verifyingContract: requirements.asset as `0x${string}`,
        },
        nonce: authorization.nonce as `0x${string}`,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        signature: envelope.signature as `0x${string}`,
      },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidChallenge(): Error {
  return new Error("PAYMENT_CHALLENGE_INVALID: unsupported x402 exact input");
}
