import { Credential } from "mppx";
import type { Types } from "mppx/evm";
import type { ChargeSettlementCommand } from "./charge-settlement-command";
import type { BasePaymentNetwork } from "../receipt-verifier";

export interface ValidatedMppCharge {
  credential: Credential.Credential<Types.AuthorizationPayload>;
  payload: Types.AuthorizationPayload;
  request: Types.ChargeRequest;
}

export class MppEvmChargeAdapter {
  constructor(private readonly network: BasePaymentNetwork) {}

  toCommand(validated: ValidatedMppCharge): ChargeSettlementCommand {
    assertKnownKeys(validated.credential, ["challenge", "payload", "source"]);
    assertKnownKeys(validated.credential.challenge, [
      "description",
      "expires",
      "id",
      "intent",
      "method",
      "opaque",
      "realm",
      "request",
    ]);
    assertKnownKeys(validated.request, [
      "amount",
      "currency",
      "description",
      "externalId",
      "methodDetails",
      "recipient",
    ]);
    assertKnownKeys(validated.request.methodDetails, [
      "chainId",
      "credentialTypes",
      "decimals",
      "splits",
    ]);
    const { payload, request } = validated;
    const expectedChainId = this.network === "eip155:8453" ? 8453 : 84532;
    if (request.methodDetails.chainId !== expectedChainId) {
      throw new Error("PAYMENT_CHALLENGE_INVALID: MPP network mismatch");
    }
    return {
      protocolId: "mpp-evm-charge-v0",
      adapterRevision: "mpp-evm-charge-v0",
      network: this.network,
      asset: request.currency as `0x${string}`,
      amount: request.amount,
      payer: payload.from as `0x${string}`,
      payTo: request.recipient as `0x${string}`,
      authorization: {
        domain: {
          name: this.network === "eip155:8453" ? "USD Coin" : "USDC",
          version: "2",
          chainId: expectedChainId,
          verifyingContract: request.currency as `0x${string}`,
        },
        nonce: payload.nonce as `0x${string}`,
        validAfter: payload.validAfter,
        validBefore: payload.validBefore,
        signature: payload.signature as `0x${string}`,
      },
    };
  }
}

export function assertMppCredentialHasNoUnknownExtensions(header: string): void {
  const credential = decodeCredentialWire(header);
  assertKnownKeys(credential, ["challenge", "payload", "source"]);
  const payload = credential.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("PAYMENT_CHALLENGE_INVALID: invalid MPP payload");
  }
  assertKnownKeys(payload, [
    "from",
    "nonce",
    "signature",
    "to",
    "type",
    "validAfter",
    "validBefore",
    "value",
  ]);
  assertKnownKeys(credential.challenge, [
    "description",
    "expires",
    "id",
    "intent",
    "method",
    "opaque",
    "realm",
    "request",
  ]);
  const extracted = Credential.extractPaymentScheme(header);
  if (!extracted) {
    throw new Error("PAYMENT_CHALLENGE_INVALID: missing MPP credential");
  }
  const normalized = Credential.deserialize(
    extracted.replace(/^Payment\s+/i, "Payment "),
  );
  assertKnownKeys(normalized.challenge.request, [
    "amount",
    "currency",
    "description",
    "externalId",
    "methodDetails",
    "recipient",
  ]);
  const methodDetails = normalized.challenge.request.methodDetails;
  if (!methodDetails || typeof methodDetails !== "object" || Array.isArray(methodDetails)) {
    throw new Error("PAYMENT_CHALLENGE_INVALID: invalid MPP method details");
  }
  assertKnownKeys(methodDetails, ["chainId", "credentialTypes", "decimals", "splits"]);
}

export function assertMppPayloadHasNoUnknownExtensions(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PAYMENT_CHALLENGE_INVALID: invalid MPP payload");
  }
  assertKnownKeys(value, [
    "from",
    "nonce",
    "signature",
    "to",
    "type",
    "validAfter",
    "validBefore",
    "value",
  ]);
}

function decodeCredentialWire(header: string): Record<string, unknown> & {
  challenge: Record<string, unknown>;
} {
  const value = Credential.extractPaymentScheme(header);
  if (!value) {
    throw new Error("PAYMENT_CHALLENGE_INVALID: missing MPP credential");
  }
  const encoded = value.replace(/^Payment\s+/i, "");
  const base64 = encoded
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const decoded = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(decoded)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PAYMENT_CHALLENGE_INVALID: malformed MPP credential");
  }
  const credential = parsed as Record<string, unknown>;
  const challenge = credential.challenge;
  if (!challenge || typeof challenge !== "object" || Array.isArray(challenge)) {
    throw new Error("PAYMENT_CHALLENGE_INVALID: malformed MPP challenge");
  }
  return credential as Record<string, unknown> & {
    challenge: Record<string, unknown>;
  };
}

function assertKnownKeys(value: object, allowed: readonly string[]): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) {
    throw new Error("PAYMENT_CHALLENGE_INVALID: unknown MPP extension");
  }
}
