// marked as internal to prevent inclusion in the core docs
/** @internal */
export {
  ApiKeyStamper,
  signWithApiKey,
  type TApiKeyStamperConfig,
} from "@0xkey-io/api-key-stamper";

// marked as internal to prevent inclusion in the core docs
/** @internal */
export {
  type TWebauthnStamperConfig,
  WebauthnStamper,
} from "@0xkey-io/webauthn-stamper";

export { ZeroXKeyClient, type ZeroXKeyClientMethods } from "./__clients__/core";
export { type ZeroXKeySDKClientBase } from "./__generated__/sdk-client-base";

// Export all types and values from __types__/
export * from "./__types__/auth";
export * from "./__types__/config";
export * from "./__types__/enums";
export * from "./__types__/error";
export * from "./__types__/export";
export * from "./__types__/external-wallets";
export * from "./__types__/http";
export * from "./__types__/method-types/import-export-params";
export * from "./__types__/method-types/shared";

/**@internal */
export {
  generateWalletAccountsFromAddressFormat,
  isEthereumProvider,
  isSolanaProvider,
  getAuthProxyConfig,
  sendSignedRequest,
  decodeVerificationToken,
  getClientSignatureMessageForLogin,
  getClientSignatureMessageForSignup,
  addressFormatConfig,
} from "./utils";

export * from "@0xkey-io/sdk-types";
