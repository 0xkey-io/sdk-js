import { describe, expect, it } from "@jest/globals";
import { ZeroXKeyError, ZeroXKeyErrorCodes } from "@0xkey-io/sdk-types";
import { signerPublicKeyFor } from "../utils/enclave-signer";

// Signer keys that sign export and import bundles in each environment: the
// production pin, and the sign half of enclave-staging-ops
// shared/quorum_key.pub (also pinned by https://export.staging.0xkey.io).
const PROD_SIGNER =
  "046d10ba0b618a5fd338a39e95e0236bb50fa323804952da886aa3768cd6b603747d606778096d5eb24644600f6f7d4a634a93043a8a5db99081068e1e03a9f201";
const STAGING_SIGNER =
  "046f2e6d75c39167e1e23dce9f12920edbcf3e82dbf6f09e7acfaa8e00f9945e5bfe598439367c295bf05920edab68213b739a9eebd5f159397db29d3c50dd91a9";

describe("signerPublicKeyFor", () => {
  it("defaults to the production signer", () => {
    expect(signerPublicKeyFor(undefined)).toBe(PROD_SIGNER);
    expect(signerPublicKeyFor("prod")).toBe(PROD_SIGNER);
  });

  it("pins the staging signer for staging", () => {
    expect(signerPublicKeyFor("staging")).toBe(STAGING_SIGNER);
  });

  it("rejects environments without a pinned signer", () => {
    for (const environment of ["preprod", "dev", "", "STAGING"]) {
      let thrown: unknown;
      try {
        signerPublicKeyFor(environment as never);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ZeroXKeyError);
      expect((thrown as ZeroXKeyError).code).toBe(
        ZeroXKeyErrorCodes.INVALID_CONFIGURATION,
      );
    }
  });
});
