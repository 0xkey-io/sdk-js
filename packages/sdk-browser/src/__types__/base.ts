import type { TActivityId, TActivityStatus } from "@0xkey-io/http";
import type { WalletInterface, WalletStamper } from "@0xkey-io/wallet-stamper";
import type { WebauthnStamper } from "@0xkey-io/webauthn-stamper";
import type { IframeStamper } from "@0xkey-io/iframe-stamper";
import type { IndexedDbStamper } from "@0xkey-io/indexed-db-stamper";
import type { SessionType } from "@0xkey-io/sdk-types";

export type GrpcStatus = {
  message?: string | undefined;
  /**
   * Auth Proxy error bodies use `{ "error": "...", "code": "OIDC_..." }`:
   * the text is in `error` and `code` is a string.
   */
  error?: string | undefined;
  code?: number | string | undefined;
  details?: unknown[] | null | undefined;
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

/** gRPC `UNKNOWN`, used when the body carries no numeric code. */
const GRPC_CODE_UNKNOWN = 2;

/**
 * Reads a gRPC status or Auth Proxy error body. The text comes from
 * `message`, or from `error` when `message` is empty. A numeric `code` (or a
 * string of digits only) is the gRPC code; any other string `code` such as
 * `OIDC_TOKEN_EXPIRED` is kept as `errorCode`. This class has no HTTP status,
 * so without a numeric `code` the gRPC code is `UNKNOWN` (2); the `core`
 * package derives it from the HTTP status instead.
 */
function parseErrorBody(input: GrpcStatus): {
  message: string;
  code: number;
  errorCode: string | undefined;
} {
  const message =
    typeof input.message === "string" && input.message !== ""
      ? input.message
      : typeof input.error === "string"
        ? input.error
        : "";
  if (typeof input.code === "number") {
    return { message, code: input.code, errorCode: undefined };
  }
  if (typeof input.code === "string" && input.code !== "") {
    return /^\d+$/.test(input.code)
      ? { message, code: Number(input.code), errorCode: undefined }
      : { message, code: GRPC_CODE_UNKNOWN, errorCode: input.code };
  }
  return { message, code: GRPC_CODE_UNKNOWN, errorCode: undefined };
}

export class ZeroXKeyRequestError extends Error {
  details: any[] | null;
  /** gRPC status code; `2` (UNKNOWN) when the body has no numeric code. */
  code: number;
  /** String `code` of the body (for example `OIDC_TOKEN_EXPIRED`), if any. */
  errorCode: string | undefined;

  constructor(input: GrpcStatus) {
    const parsed = parseErrorBody(input);
    let zeroXKeyErrorMessage = `0xkey error ${parsed.errorCode ?? parsed.code}: ${parsed.message}`;

    if (input.details != null) {
      zeroXKeyErrorMessage += ` (Details: ${JSON.stringify(input.details)})`;
    }

    super(zeroXKeyErrorMessage);

    this.name = "ZeroXKeyRequestError";
    this.details = input.details ?? null;
    this.code = parsed.code;
    this.errorCode = parsed.errorCode;
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
