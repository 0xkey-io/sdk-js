import { ZeroXKeyClient } from "@0xkey-io/http";

export type Email = `${string}@${string}.${string}`;

export type Attestation = Parameters<
  ZeroXKeyClient["createSubOrganization"]
>[0]["parameters"]["rootUsers"][0]["authenticators"][0]["attestation"];

export interface PasskeyRegistrationResult {
  challenge: string;
  attestation: Attestation;
}
