import type { TActivityId, TActivityStatus } from "@0xkey-io/http";
import type { WalletInterface, WalletStamper } from "@0xkey-io/wallet-stamper";
import type { WebauthnStamper } from "@0xkey-io/webauthn-stamper";
import type { IframeStamper } from "@0xkey-io/iframe-stamper";
import type { IndexedDbStamper } from "@0xkey-io/indexed-db-stamper";
import type { SessionType } from "@0xkey-io/sdk-types";

export type GrpcStatus = {
  message: string;
  code: number;
  details: unknown[] | null;
};

export enum MethodType {
  Get,
  List,
  Command,
}

export type TStamp = {
  stampHeaderName: string;
  stampHeaderValue: string;
};

export interface TStamper {
  stamp: (input: string) => Promise<TStamp>;
}

export type THttpConfig = {
  baseUrl: string;
};

export class ZeroXKeyRequestError extends Error {
  details: any[] | null;
  code: number;

  constructor(input: GrpcStatus) {
    let zeroXKeyErrorMessage = `ZeroXKey error ${input.code}: ${input.message}`;

    if (input.details != null) {
      zeroXKeyErrorMessage += ` (Details: ${JSON.stringify(input.details)})`;
    }

    super(zeroXKeyErrorMessage);

    this.name = "ZeroXKeyRequestError";
    this.details = input.details ?? null;
    this.code = input.code;
  }
}

export interface ActivityResponse {
  activity: {
    id: TActivityId;
    status: TActivityStatus;
    result: Record<string, any>;
  };
}

export interface ActivityMetadata {
  activity: {
    id: TActivityId;
    status: TActivityStatus;
  };
}

export type TActivityPollerConfig = {
  intervalMs: number;
  numRetries: number;
};

interface BaseSDKClientConfig {
  apiBaseUrl: string;
  organizationId: string;
  activityPoller?: TActivityPollerConfig | undefined;
}

interface SDKClientConfigWithStamper extends BaseSDKClientConfig {
  stamper: TStamper;
  readOnlySession?: never;
}

interface SDKClientConfigWithReadOnlySession extends BaseSDKClientConfig {
  stamper?: never;
  readOnlySession: string;
}

export type ZeroXKeySDKClientConfig =
  | SDKClientConfigWithStamper
  | SDKClientConfigWithReadOnlySession;

export interface ZeroXKeySDKBrowserConfig {
  apiBaseUrl: string;
  defaultOrganizationId: string;
  rpId?: string;
  serverSignUrl?: string;
  iframeUrl?: string;
  dangerouslyOverrideIframeKeyTtl?: number;
}

export type Stamper =
  | WebauthnStamper
  | IframeStamper
  | WalletStamper
  | IndexedDbStamper;

export type queryOverrideParams = {
  organizationId?: string;
};

export type commandOverrideParams = {
  organizationId?: string;
  timestampMs?: string;
};

export interface IframeClientParams {
  iframeContainer: HTMLElement | null | undefined;
  iframeUrl: string;
  iframeElementId?: string;
  dangerouslyOverrideIframeKeyTtl?: number;
}

export interface PasskeyClientParams {
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: PublicKeyCredentialDescriptor[];
}

export interface RefreshSessionParams {
  sessionType?: SessionType;
  expirationSeconds?: string;
  invalidateExisting?: boolean;
  publicKey?: string;
}

export interface LoginWithBundleParams {
  bundle: string;
  expirationSeconds?: string;
}

export interface LoginWithPasskeyParams {
  publicKey?: string;
  organizationId?: string;
  sessionType: SessionType;
  expirationSeconds?: string | undefined;
}

export interface LoginWithWalletParams {
  publicKey?: string;
  organizationId?: string;
  sessionType: SessionType;
  expirationSeconds?: string | undefined;
}

export interface ZeroXKeyWalletClientConfig extends SDKClientConfigWithStamper {
  wallet: WalletInterface;
}

/**
 * The Client used to authenticate the user.
 */
export enum AuthClient {
  Passkey = "passkey",
  Wallet = "wallet",
  Iframe = "iframe",
  IndexedDb = "indexed-db",
}
