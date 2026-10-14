import {
  PRODUCTION_SIGNER_SIGN_PUBLIC_KEY,
  STAGING_QUORUM_KEY_HEX,
} from "@0xkey-io/crypto";
import { ZeroXKeyError, ZeroXKeyErrorCodes } from "@0xkey-io/sdk-types";

/** Enclave environment whose Signer key export and import bundles must carry. */
export type SignerEnvironment = "prod" | "staging";

// A quorum key is the uncompressed encrypt point followed by the uncompressed
// sign point, 65 bytes (130 hex chars) each.
const STAGING_SIGNER_SIGN_PUBLIC_KEY = STAGING_QUORUM_KEY_HEX.slice(130);

/**
 * Returns the pinned Signer public key for `environment` (default `"prod"`).
 * Only pinned keys can be selected; there is no way to pass an arbitrary key.
 */
export function signerPublicKeyFor(
  environment: SignerEnvironment | undefined,
): string {
  switch (environment ?? "prod") {
    case "prod":
      return PRODUCTION_SIGNER_SIGN_PUBLIC_KEY;
    case "staging":
      return STAGING_SIGNER_SIGN_PUBLIC_KEY;
    default:
      throw new ZeroXKeyError(
        'signerEnvironment must be "prod" or "staging"',
        ZeroXKeyErrorCodes.INVALID_CONFIGURATION,
      );
  }
}
