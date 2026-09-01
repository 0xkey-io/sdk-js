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
    assertExactKeys(paymentPayload, ["accepted", "payload", "resource", "x402Version"]);
    if (paymentPayload.resource !== undefined) {
      if (!isRecord(paymentPayload.resource)) throw invalidChallenge();
      assertExactKeys(paymentPayload.resource, ["description", "mimeType", "url"]);
    }
    assertExactKeys(paymentPayload.accepted, [
      "amount",
      "asset",
      "extra",
      "maxTimeoutSeconds",
      "network",
      "payTo",
      "scheme",
    ]);
    assertExactKeys(envelope, ["authorization", "signature"]);
    assertExactKeys(authorization, [
      "from",
      "nonce",
      "to",
      "validAfter",
      "validBefore",
      "value",
    ]);
    if (
      paymentPayload.x402Version !== 2 ||
      requirements.scheme !== "exact" ||
      paymentPayload.accepted.scheme !== requirements.scheme ||
      requirements.network !== this.network ||
      paymentPayload.accepted.network !== this.network ||
      getAddress(requirements.asset) !== getAddress(ASSET_BY_NETWORK[this.network]) ||
      getAddress(paymentPayload.accepted.asset) !== getAddress(requirements.asset) ||
      paymentPayload.accepted.amount !== requirements.amount ||
      paymentPayload.accepted.maxTimeoutSeconds !== requirements.maxTimeoutSeconds ||
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
    if (
      !isRecord(paymentPayload.accepted.extra) ||
      Object.keys(paymentPayload.accepted.extra).some((key) => !allowedExtra.has(key)) ||
      !sameStringRecord(paymentPayload.accepted.extra, requirements.extra ?? {})
    ) {
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

function assertExactKeys(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalidChallenge();
}

function sameStringRecord(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const leftKeys = Object.keys(left);
  return leftKeys.length === Object.keys(right).length &&
    leftKeys.every((key) => typeof left[key] === "string" && left[key] === right[key]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidChallenge(): Error {
  return new Error("PAYMENT_CHALLENGE_INVALID: unsupported x402 exact input");
}
