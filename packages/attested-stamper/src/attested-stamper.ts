import { p256 } from "@noble/curves/p256";
import { SignatureFormat } from "@0xkey-io/api-key-stamper";
import { stringToBase64urlString } from "@0xkey-io/encoding";

export enum AttestedScheme {
  P256_OIDC = "STAMP_ATTESTED_SCHEME_P256_OIDC",
  P256_VERIFICATION_TOKEN = "STAMP_ATTESTED_SCHEME_P256_VERIFICATION_TOKEN",
}

export interface AttestedConfig {
  attestedIdentity: string;
  publicKey: string;
  scheme: AttestedScheme;
}

export interface AttestedSigner {
  sign(
    payload: string,
    format: SignatureFormat,
    publicKey?: string,
  ): Promise<string>;
}

export interface AttestedStamp {
  stampHeaderName: "X-Stamp-Attested";
  stampHeaderValue: string;
}

export class AttestedStamper {
  private readonly signer: AttestedSigner;
  public attestedIdentity: string | undefined;
  public publicKey: string | undefined;
  private scheme: AttestedScheme = AttestedScheme.P256_VERIFICATION_TOKEN;

  constructor(signer: AttestedSigner) {
    this.signer = signer;
  }

  configure(config: AttestedConfig): void {
    this.attestedIdentity = config.attestedIdentity;
    this.publicKey = config.publicKey;
    this.scheme = config.scheme;
  }

  clear(): void {
    this.attestedIdentity = undefined;
    this.publicKey = undefined;
    this.scheme = AttestedScheme.P256_VERIFICATION_TOKEN;
  }

  async stamp(payload: string): Promise<AttestedStamp> {
    if (!this.attestedIdentity) {
      throw new Error(
        "Attested identity not set. Please configure the stamper before stamping.",
      );
    }
    if (!this.publicKey) {
      throw new Error(
        "Attested public key not set. Please configure the stamper before stamping.",
      );
    }

    const derSignature = await this.signer.sign(
      payload,
      SignatureFormat.Der,
      this.publicKey,
    );
    const signature = p256.Signature.fromDER(derSignature)
      .normalizeS()
      .toDERHex();
    const value = JSON.stringify({
      publicKeyAttestation: this.attestedIdentity,
      scheme: this.scheme,
      publicKey: this.publicKey,
      signature,
    });

    return {
      stampHeaderName: "X-Stamp-Attested",
      stampHeaderValue: stringToBase64urlString(value),
    };
  }
}
