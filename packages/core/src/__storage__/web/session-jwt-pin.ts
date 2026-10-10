import { PRODUCTION_SIGNER_SIGN_PUBLIC_KEY } from "@0xkey-io/crypto";

/**
 * Immutable production Signer trust anchor. A staging SDK build needs its own
 * trusted deployment pin (the sign half of STAGING_QUORUM_KEY_HEX); never
 * select a JWT verification key from a token, browser config, or proxy reply.
 */
export const SESSION_JWT_SIGNING_KEY_HEX = PRODUCTION_SIGNER_SIGN_PUBLIC_KEY;
