// marked as internal to prevent inclusion in the http docs
/** @internal */
import { PublicApiService as ZeroXKeyApi } from "./__generated__/barrel";

// marked as internal to prevent inclusion in the http docs
/** @internal */
export type { definitions as ZeroXKeyApiTypes } from "./__generated__/services/coordinator/public/v1/public_api.types";

// marked as internal to prevent inclusion in the http docs
/** @internal */
export { ZeroXKeyClient } from "./__generated__/services/coordinator/public/v1/public_api.client";

export { init, browserInit } from "./config";
export { ZeroXKeyRequestError } from "./base";
export {
  assertNonNull,
  assertActivityCompleted,
  getSignatureFromActivity,
  getSignaturesFromActivity,
  getSignedTransactionFromActivity,
  InvalidArgumentError,
  ZeroXKeyActivityError,
  ZeroXKeyActivityConsensusNeededError,
  type TActivity,
  type TActivityId,
  type TActivityResponse,
  type TActivityStatus,
  type TActivityType,
  type TSignature,
  TERMINAL_ACTIVITY_STATUSES,
} from "./shared";
export type { SignedRequest, TSignedRequest } from "./base";
export { getWebAuthnAttestation } from "./webauthn";
export { withAsyncPolling, createActivityPoller } from "./async";

export { ZeroXKeyApi };

export { sealAndStampRequestBody, isHttpClient } from "./base";

export { VERSION } from "./version";
