import {
  ApiKeyStamper,
  signWithApiKey,
  TApiKeyStamperConfig,
} from "@0xkey-io/api-key-stamper";

import {
  createActivityPoller,
  getWebAuthnAttestation,
  sealAndStampRequestBody,
  ZeroXKeyActivityError,
  ZeroXKeyApi,
  ZeroXKeyRequestError,
  type TSignedRequest,
  type TActivity,
  type ZeroXKeyApiTypes,
} from "@0xkey-io/http";

import {
  ZeroXKeyServerSDK,
  ZeroXKeyServerClient,
  ZeroXKeyApiClient,
} from "./sdk-client";
import type { PollTransactionStatusParams } from "./sdk-client";

import type {
  ZeroXKeySDKClientConfig,
  ZeroXKeySDKServerConfig,
  ZeroXKeyProxyHandlerConfig,
  WalletAccount,
} from "./__types__/base";

import type * as ZeroXKeySDKApiTypes from "./__generated__/sdk_api_types";

import { fetch } from "./universal";
import {
  createSuborg,
  getSuborgs,
  getVerifiedSuborgs,
  sendOtp,
  verifyOtp,
  oauthLogin,
  otpLogin,
  getOrCreateSuborg,
  sendCredential,
  getUsers,
  createOauthProviders,
} from "./actions";

// Classes
export {
  ApiKeyStamper,
  ZeroXKeyActivityError,
  ZeroXKeyApiClient,
  ZeroXKeyServerSDK as ZeroXKey,
  ZeroXKeyServerClient,
  ZeroXKeyRequestError,
};

// Server Actions
export const server = {
  verifyOtp,
  sendOtp,
  oauthLogin,
  otpLogin,
  getUsers,
  getSuborgs,
  getVerifiedSuborgs,
  createSuborg,
  getOrCreateSuborg,
  createOauthProviders,
  sendCredential,
};

// Types
export type {
  PollTransactionStatusParams,
  TActivity,
  WalletAccount,
  TApiKeyStamperConfig,
  TSignedRequest,
  ZeroXKeyApiTypes,
  ZeroXKeySDKApiTypes,
  ZeroXKeySDKClientConfig,
  ZeroXKeySDKServerConfig,
  ZeroXKeyProxyHandlerConfig,
};

// Functions
export {
  fetch,
  createActivityPoller,
  getWebAuthnAttestation,
  sealAndStampRequestBody,
  signWithApiKey,
};

// Constants
export {
  defaultEthereumAccountAtIndex,
  DEFAULT_ETHEREUM_ACCOUNTS,
  defaultCosmosAccountAtIndex,
  DEFAULT_COSMOS_ACCOUNTS,
  defaultTronAccountAtIndex,
  DEFAULT_TRON_ACCOUNTS,
  defaultBitcoinMainnetP2PKHAccountAtIndex,
  DEFAULT_BITCOIN_MAINNET_P2PKH_ACCOUNTS,
  defaultBitcoinMainnetP2WPKHAccountAtIndex,
  DEFAULT_BITCOIN_MAINNET_P2WPKH_ACCOUNTS,
  defaultBitcoinMainnetP2WSHAccountAtIndex,
  DEFAULT_BITCOIN_MAINNET_P2WSH_ACCOUNTS,
  defaultBitcoinMainnetP2TRAccountAtIndex,
  DEFAULT_BITCOIN_MAINNET_P2TR_ACCOUNTS,
  defaultBitcoinMainnetP2SHAccountAtIndex,
  DEFAULT_BITCOIN_MAINNET_P2SH_ACCOUNTS,
  defaultBitcoinTestnetP2PKHAccountAtIndex,
  DEFAULT_BITCOIN_TESTNET_P2PKH_ACCOUNTS,
  defaultBitcoinTestnetP2WPKHAccountAtIndex,
  DEFAULT_BITCOIN_TESTNET_P2WPKH_ACCOUNTS,
  defaultBitcoinTestnetP2WSHAccountAtIndex,
  DEFAULT_BITCOIN_TESTNET_P2WSH_ACCOUNTS,
  defaultBitcoinTestnetP2TRAccountAtIndex,
  DEFAULT_BITCOIN_TESTNET_P2TR_ACCOUNTS,
  defaultBitcoinTestnetP2SHAccountAtIndex,
  DEFAULT_BITCOIN_TESTNET_P2SH_ACCOUNTS,
  defaultBitcoinSignetP2PKHAccountAtIndex,
  DEFAULT_BITCOIN_SIGNET_P2PKH_ACCOUNTS,
  defaultBitcoinSignetP2WPKHAccountAtIndex,
  DEFAULT_BITCOIN_SIGNET_P2WPKH_ACCOUNTS,
  defaultBitcoinSignetP2WSHAccountAtIndex,
  DEFAULT_BITCOIN_SIGNET_P2WSH_ACCOUNTS,
  defaultBitcoinSignetP2TRAccountAtIndex,
  DEFAULT_BITCOIN_SIGNET_P2TR_ACCOUNTS,
  defaultBitcoinSignetP2SHAccountAtIndex,
  DEFAULT_BITCOIN_SIGNET_P2SH_ACCOUNTS,
  defaultBitcoinRegtestP2PKHAccountAtIndex,
  DEFAULT_BITCOIN_REGTEST_P2PKH_ACCOUNTS,
  defaultBitcoinRegtestP2WPKHAccountAtIndex,
  DEFAULT_BITCOIN_REGTEST_P2WPKH_ACCOUNTS,
  defaultBitcoinRegtestP2WSHAccountAtIndex,
  DEFAULT_BITCOIN_REGTEST_P2WSH_ACCOUNTS,
  defaultBitcoinRegtestP2TRAccountAtIndex,
  DEFAULT_BITCOIN_REGTEST_P2TR_ACCOUNTS,
  defaultBitcoinRegtestP2SHAccountAtIndex,
  DEFAULT_BITCOIN_REGTEST_P2SH_ACCOUNTS,
  defaultDogeMainnetAccountAtIndex,
  DEFAULT_DOGE_MAINNET_ACCOUNTS,
  defaultDogeTestnetAccountAtIndex,
  DEFAULT_DOGE_TESTNET_ACCOUNTS,
  defaultSeiAccountAtIndex,
  DEFAULT_SEI_ACCOUNTS,
  defaultXrpAccountAtIndex,
  defaultSolanaAccountAtIndex,
  DEFAULT_SOLANA_ACCOUNTS,
  defaultSuiAccountAtIndex,
  DEFAULT_SUI_ACCOUNTS,
  defaultAptosAccountAtIndex,
  DEFAULT_APTOS_ACCOUNTS,
  defaultXlmAccountAtIndex,
  DEFAULT_XLM_ACCOUNTS,
  defaultTonV3r2AccountAtIndex,
  DEFAULT_TON_V3R2_ACCOUNTS,
  defaultTonV4r2AccountAtIndex,
  DEFAULT_TON_V4R2_ACCOUNTS,
} from "./0xkey-helpers";

// Base ZeroXKey API
export { ZeroXKeyApi };
