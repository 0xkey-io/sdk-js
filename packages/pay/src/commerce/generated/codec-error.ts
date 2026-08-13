export type CommerceCodecErrorCode =
  | "UNSUPPORTED_PROTOCOL_VERSION"
  | "SCHEMA_INVALID"
  | "CONTRACT_DIGEST_MISMATCH";

export class CommerceCodecError extends Error {
  constructor(readonly code: CommerceCodecErrorCode) {
    super(code);
    this.name = "CommerceCodecError";
  }
}
