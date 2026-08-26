import { Credential, Receipt, x402 } from "mppx";
import { Mppx } from "mppx/client";
import { assets, Types as EvmTypes } from "mppx/evm";
import { charge } from "mppx/evm/client";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import { getAddress, sha256, stringToBytes, type Account } from "viem";
import {
  createBaseReceiptVerifier,
  createEip3009EconomicEffect,
  type BasePaymentNetwork,
  type Eip3009EconomicEffect,
  type PaymentReceiptVerifier,
  type PaymentReceiptVerificationInput,
} from "./receipt-verifier";
import { assertBasePaymentNetwork } from "./networks";
import { PayError, type PayErrorCode, type PayErrorPhase } from "./errors";

export { PayError } from "./errors";
export type { PayErrorCode, PayErrorPhase, PayErrorOptions } from "./errors";

export type {
  BasePaymentNetwork,
  PaymentReceiptVerifier,
  PaymentReceiptVerificationInput,
} from "./receipt-verifier";

export type PayProtocol = "x402" | "mpp";
export type PayProtocolId = "x402-exact-v2-eip3009" | "mpp-evm-charge-v0";

/**
 * Minimal signer seam used by Pay. Keeping the full Viem Account out of the
 * public Interface lets 0xkey TEE adapters and local accounts from compatible
 * Viem minors provide the only two capabilities the payment flow needs.
 */
export interface PayEvmAccount {
  address: `0x${string}`;
  signTypedData: (...parameters: never[]) => Promise<`0x${string}`>;
}

export interface NormalizedPaymentReceipt {
  protocol: PayProtocol;
  reference: string;
  status: "success";
  payer?: string;
  network?: string;
  timestamp?: string;
}

interface CreatePayExecutorOptions {
  account: PayEvmAccount;
  allowHosts: string[];
  maxAmount: string;
  /** Required rail selection. A signed payment can never switch networks. */
  network: BasePaymentNetwork;
  protocolPreference?: PayProtocol[];
  /** Local development only. Allows HTTP to exact loopback hostnames. */
  allowInsecureLocalhost?: boolean;
  fetch?: typeof globalThis.fetch;
  /** Overrides Base on-chain receipt checks. Tests may inject a fake. */
  receiptVerifier?: PaymentReceiptVerifier;
  /** RPC endpoints used only for receipt checks. Production must set Base mainnet. */
  rpcUrls?: Partial<Record<BasePaymentNetwork, string>>;
  onReceipt?: (receipt: NormalizedPaymentReceipt, url: string) => void;
  /** Durable single-slot storage for one unresolved signed request. */
  pendingPaymentStore: PendingPaymentStore;
}

export interface CreatePayClientOptions {
  account: PayEvmAccount;
  network: BasePaymentNetwork;
  policy: {
    allowHosts: readonly string[];
    maxAmount: string;
    preference?: readonly PayProtocol[];
  };
  recovery: PendingPaymentStore;
  verification:
    | { rpcUrl: string; verifier?: never }
    | { verifier: PaymentReceiptVerifier; rpcUrl?: never };
  fetch?: typeof globalThis.fetch;
  allowInsecureLocalhost?: boolean;
  onReceipt?: (receipt: NormalizedPaymentReceipt, url: string) => void;
}

export interface PendingPaymentSummary {
  requestDigest: `0x${string}`;
  protocol: PayProtocol;
  protocolId: PayProtocolId;
  network: BasePaymentNetwork;
  url: string;
  method: string;
}

export interface PayClient {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  resume(): Promise<Response>;
  pending(): Promise<PendingPaymentSummary | undefined>;
}

export interface PendingPaymentStore {
  /**
   * The store MUST encrypt and authenticate every record. The key MUST live
   * outside the record. HMAC-only storage is not enough because the record
   * contains a live payment credential.
   */
  readonly protection: "aead" | "encryption+hmac";
  /** Load and authenticate the one unresolved record. Reject on auth failure. */
  load(): Promise<PendingPaymentRecord | undefined>;
  /** Atomically create the record only when the slot is empty. */
  saveIfAbsent(record: PendingPaymentRecord): Promise<boolean>;
  /** Atomically delete only the record whose digest equals expectedDigest. */
  clear(expectedDigest: `0x${string}`): Promise<boolean>;
}

export interface PendingPaymentRecord {
  digest: `0x${string}`;
  payment: SerializedPendingPayment;
}

export interface SerializedPendingPayment {
  version: 3;
  network: BasePaymentNetwork;
  protocolId: PayProtocolId;
  adapterRevision: "pay-client-v1";
  economicEffectDigest: `0x${string}`;
  /** Unkeyed checksum for accidental corruption. This is not tamper protection. */
  requestDigest: `0x${string}`;
  url: string;
  method: string;
  headers: Array<[string, string]>;
  bodyBase64?: string;
}

interface PayExecutor {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Re-send the last signed request. This never creates a new signature. */
  resume(): Promise<Response>;
  serializedPending(): Promise<SerializedPendingPayment | undefined>;
}

interface PendingPaymentFacts {
  effect: Eip3009EconomicEffect;
  protocol: PayProtocol;
}

interface DecodedPaymentReceipt {
  amountAtomic?: string;
  method?: string;
  receipt: NormalizedPaymentReceipt;
}

export function createPayClient(options: CreatePayClientOptions): PayClient {
  if (!options.recovery) {
    throw new PayError(
      "PENDING_PAYMENT_STORE_REQUIRED",
      "Durable pending-payment storage is required",
      { phase: "configuration" },
    );
  }
  if (!options.verification) {
    throw new PayError(
      "PAY_PROFILE_INVALID",
      "Receipt verification configuration is required",
      { phase: "configuration" },
    );
  }
  if (
    options.recovery.protection !== "aead" &&
    options.recovery.protection !== "encryption+hmac"
  ) {
    throw new PayError(
      "PENDING_PAYMENT_STORE_PROTECTION_REQUIRED",
      "Pending-payment storage must encrypt and authenticate records",
      { phase: "configuration" },
    );
  }
  if (options.network !== "eip155:8453" && options.network !== "eip155:84532") {
    throw new PayError(
      "PAY_NETWORK_UNSUPPORTED",
      "Only Base mainnet and Base Sepolia are supported",
      { phase: "configuration" },
    );
  }
  let executor: PayExecutor;
  try {
    executor = createPayExecutor({
      account: options.account,
      network: options.network,
      allowHosts: [...options.policy.allowHosts],
      maxAmount: options.policy.maxAmount,
      ...(options.policy.preference
        ? { protocolPreference: [...options.policy.preference] }
        : {}),
      pendingPaymentStore: options.recovery,
      ...(options.verification.verifier
        ? { receiptVerifier: options.verification.verifier }
        : { rpcUrls: { [options.network]: options.verification.rpcUrl } }),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.allowInsecureLocalhost
        ? { allowInsecureLocalhost: options.allowInsecureLocalhost }
        : {}),
      ...(options.onReceipt ? { onReceipt: options.onReceipt } : {}),
    });
  } catch (error) {
    throw normalizePayError(error, "configuration", "PAY_PROFILE_INVALID");
  }
  return {
    fetch: (input, init) =>
      runPayOperation(
        () => executor(input, init),
        "request",
        "PAYMENT_SERVICE_UNAVAILABLE",
      ),
    resume: () =>
      runPayOperation(
        () => executor.resume(),
        "recovery",
        "PAYMENT_SERVICE_UNAVAILABLE",
      ),
    async pending() {
      const payment = await runPayOperation(
        () => executor.serializedPending(),
        "recovery",
        "PAYMENT_SERVICE_UNAVAILABLE",
      );
      if (!payment) return undefined;
      const protocol =
        payment.protocolId === "x402-exact-v2-eip3009" ? "x402" : "mpp";
      return {
        requestDigest: payment.requestDigest,
        protocol,
        protocolId:
          protocol === "x402" ? "x402-exact-v2-eip3009" : "mpp-evm-charge-v0",
        network: payment.network,
        url: payment.url,
        method: payment.method,
      };
    },
  };
}

function createPayExecutor(options: CreatePayExecutorOptions): PayExecutor {
  assertBasePaymentNetwork(options.network);
  if (!options.allowHosts.length) {
    throw new Error("allowHosts must contain at least one trusted host");
  }
  const maxAmount = options.maxAmount.replace(/^\$/, "");
  if (!/^\d+(\.\d{1,6})?$/.test(maxAmount)) {
    throw new Error(
      "maxAmount must be a positive USDC amount with at most 6 decimals",
    );
  }
  const maxAmountAtomic = displayUsdcToAtomic(maxAmount);
  if (maxAmountAtomic <= 0n) {
    throw new Error("maxAmount must be greater than zero");
  }
  const preference = options.protocolPreference ?? ["x402", "mpp"];
  if (
    preference.length === 0 ||
    new Set(preference).size !== preference.length ||
    preference.some((protocol) => protocol !== "x402" && protocol !== "mpp")
  ) {
    throw new Error(
      "protocolPreference must contain unique x402 or mpp values",
    );
  }
  const paymentNetwork = options.network;
  const receiptVerifier =
    options.receiptVerifier ??
    createBaseReceiptVerifier({
      network: paymentNetwork,
      rpcUrl: receiptRpcUrl(options, paymentNetwork),
    });
  const rawFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  let pendingRequest: Request | undefined;
  let pendingRecord: PendingPaymentRecord | undefined;
  let pendingFacts: PendingPaymentFacts | undefined;
  let pendingPersisted = false;
  let paymentInProgress = false;
  let resumingPending = false;
  let storeLoaded = false;
  let storeLoad: Promise<void> | undefined;
  const guardedFetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, { ...init, redirect: "manual" });
    const url = request.url;
    assertSecureTransport(url, options.allowInsecureLocalhost);
    if (!hostAllowed(url, options.allowHosts)) {
      throw new Error(`PAY_HOST_DENIED: ${new URL(url).host}`);
    }
    if (hasPaymentCredential(request.headers)) {
      const candidateRequest = request.clone();
      const candidateFacts = inspectPendingPayment(
        candidateRequest,
        options.account.address,
        maxAmountAtomic,
        paymentNetwork,
      );
      const candidateRecord = await pendingPaymentRecord(
        candidateRequest,
        paymentNetwork,
        candidateFacts,
      );
      const isPersistedResume =
        resumingPending &&
        pendingPersisted &&
        pendingRecord?.digest === candidateRecord.digest;
      pendingRequest = candidateRequest;
      pendingFacts = candidateFacts;
      pendingRecord = candidateRecord;
      if (!isPersistedResume) {
        const claimed =
          await options.pendingPaymentStore.saveIfAbsent(candidateRecord);
        if (!claimed) {
          const stored = await options.pendingPaymentStore.load();
          if (stored) {
            await assertPendingPaymentRecord(stored);
            pendingRequest = restorePendingPayment(
              stored.payment,
              options.allowHosts,
              paymentNetwork,
              options.allowInsecureLocalhost,
            );
            pendingRecord = stored;
            pendingFacts = inspectPendingPayment(
              pendingRequest,
              options.account.address,
              maxAmountAtomic,
              paymentNetwork,
            );
            assertPendingPaymentBindings(stored.payment, pendingFacts);
            pendingPersisted = true;
          }
          throw new Error(
            "PENDING_PAYMENT_CLAIMED: another process owns an unresolved payment",
          );
        }
        pendingPersisted = true;
      }
    }
    const response = await rawFetch(request);
    if (response.url) {
      assertSecureTransport(response.url, options.allowInsecureLocalhost);
      if (!hostAllowed(response.url, options.allowHosts)) {
        throw new Error(`PAY_HOST_DENIED: ${new URL(response.url).host}`);
      }
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (location) {
        const redirectUrl = new URL(location, url).toString();
        assertSecureTransport(redirectUrl, options.allowInsecureLocalhost);
        throw new Error(`PAY_REDIRECT_DENIED: ${new URL(redirectUrl).host}`);
      }
    }
    return response;
  };
  const signTypedData = options.account.signTypedData;
  if (!signTypedData) {
    throw new Error(
      "PAY_SIGNER_UNSUPPORTED: account must support signTypedData",
    );
  }
  const safeAccount: PayEvmAccount = {
    address: options.account.address,
    async signTypedData(...parameters) {
      try {
        return await signTypedData(...parameters);
      } catch (error) {
        throw new PayError(
          "PAYMENT_SIGNING_FAILED",
          "Payment credential signing failed",
          { phase: "signing", cause: error },
        );
      }
    },
  };
  const payment = Mppx.create({
    methods: [
      charge({
        // mppx pins its own Viem Account type, but only consumes address and
        // signTypedData. The public seam above prevents that dependency's
        // minor-version internals from leaking to callers.
        account: safeAccount as Account,
        currencies:
          paymentNetwork === "eip155:8453"
            ? [assets.base.USDC]
            : [assets.baseSepolia.USDC],
        maxAmount,
        networks: paymentNetwork === "eip155:8453" ? [8453] : [84532],
      }),
    ],
    fetch: guardedFetch,
    maxPaymentRetries: 1,
    orderChallenges(candidates) {
      return candidates
        .filter((candidate) =>
          preference.includes(protocolOf(candidate.challenge)),
        )
        .sort(
          (left, right) =>
            preference.indexOf(protocolOf(left.challenge)) -
            preference.indexOf(protocolOf(right.challenge)),
        );
    },
    polyfill: false,
  });
  const officialSigner = toClientEvmSigner({
    address: safeAccount.address,
    signTypedData: (message) => safeAccount.signTypedData(message as never),
  });
  const officialX402Client = new x402Client()
    .register(paymentNetwork, new ExactEvmScheme(officialSigner))
    .registerPolicy((_version, requirements) =>
      requirements.filter(
        (requirement) =>
          requirement.network === paymentNetwork &&
          supportedX402Requirement(requirement.network, requirement.asset) &&
          BigInt(requirement.amount) <= displayUsdcToAtomic(maxAmount),
      ),
    );
  const officialX402Fetch = wrapFetchWithPayment(
    guardedFetch,
    officialX402Client,
  );

  const executeFetch = async function executeFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (paymentInProgress) {
      throw new Error(
        "PAYMENT_IN_PROGRESS: another payment request is running",
      );
    }
    paymentInProgress = true;
    try {
      await ensurePendingPaymentLoaded();
      if (pendingRequest) {
        throw new Error(
          "PAYMENT_RESUME_REQUIRED: call client.resume() before signing again",
        );
      }
      const url = requestUrl(input);
      assertSecureTransport(url, options.allowInsecureLocalhost);
      if (!hostAllowed(url, options.allowHosts)) {
        throw new Error(`PAY_HOST_DENIED: ${new URL(url).host}`);
      }
      let response: Response;
      try {
        response = await payment.fetch(input, init);
      } catch (error) {
        // mppx 0.8.17 requires its route-binding extension when it signs x402.
        // Ordinary x402 servers do not send that extension. No credential has
        // been signed at this point, so it is safe to hand the same request to
        // the official x402 client. Both libraries are exact-version pinned.
        if (
          !pendingRequest &&
          preference.includes("x402") &&
          error instanceof Error &&
          error.message === "x402 exact EIP-3009 requires route binding."
        ) {
          response = await officialX402Fetch(input, init);
        } else {
          throw error;
        }
      }
      return await finishPaymentResponse(response, url);
    } finally {
      paymentInProgress = false;
    }
  } as PayExecutor;

  executeFetch.resume = async () => {
    if (paymentInProgress) {
      throw new Error(
        "PAYMENT_IN_PROGRESS: another payment request is running",
      );
    }
    paymentInProgress = true;
    try {
      await ensurePendingPaymentLoaded();
      if (!pendingRequest) {
        throw new Error(
          "PAYMENT_RESUME_UNAVAILABLE: no signed request is pending",
        );
      }
      const url = pendingRequest.url;
      resumingPending = true;
      try {
        const response = await guardedFetch(pendingRequest.clone());
        return await finishPaymentResponse(response, url);
      } finally {
        resumingPending = false;
      }
    } finally {
      paymentInProgress = false;
    }
  };
  executeFetch.serializedPending = async () => {
    await ensurePendingPaymentLoaded();
    if (!pendingRequest) return undefined;
    return serializePendingPayment(
      pendingRequest,
      paymentNetwork,
      pendingFacts!,
    );
  };
  return executeFetch;

  async function finishPaymentResponse(
    response: Response,
    url: string,
  ): Promise<Response> {
    const decodedReceipt = decodeReceipt(response);
    if (decodedReceipt) {
      let matches = false;
      try {
        matches = Boolean(
          pendingFacts &&
            (await receiptMatches(
              decodedReceipt,
              pendingFacts,
              receiptVerifier,
            )),
        );
      } catch (error) {
        throw new Error(
          "PAYMENT_RECEIPT_UNVERIFIED: Base receipt could not be checked",
          { cause: error },
        );
      }
      if (!matches) {
        throw new Error(
          "PAYMENT_RECEIPT_MISMATCH: receipt does not match pending payment",
        );
      }
      if (pendingRecord) {
        const cleared = await options.pendingPaymentStore.clear(
          pendingRecord.digest,
        );
        if (!cleared) {
          throw new Error(
            "PENDING_PAYMENT_CLEAR_CONFLICT: durable payment record was not cleared",
          );
        }
      }
      pendingRequest = undefined;
      pendingRecord = undefined;
      pendingFacts = undefined;
      pendingPersisted = false;
      options.onReceipt?.(decodedReceipt.receipt, url);
      return response;
    }
    if (pendingRequest && response.ok) {
      throw new Error(
        "PAYMENT_RECEIPT_MISSING: signed request succeeded without a payment receipt",
      );
    }
    if (pendingRequest && response.status >= 500) {
      throw await paymentStatusUnknown(response);
    }
    if (!pendingRequest && response.status === 402) {
      throw new PayError(
        "PAYMENT_OFFER_UNSUPPORTED",
        "The server did not offer a supported payment method",
        { phase: "challenge" },
      );
    }
    return response;
  }

  async function ensurePendingPaymentLoaded(): Promise<void> {
    if (!storeLoaded) {
      storeLoad ??= (async () => {
        const stored = await options.pendingPaymentStore.load();
        if (stored) {
          await assertPendingPaymentRecord(stored);
          if (pendingRequest) {
            pendingFacts = inspectPendingPayment(
              pendingRequest,
              options.account.address,
              maxAmountAtomic,
              paymentNetwork,
            );
            const manual = await pendingPaymentRecord(
              pendingRequest,
              paymentNetwork,
              pendingFacts,
            );
            if (manual.digest !== stored.digest) {
              throw new Error(
                "PENDING_PAYMENT_CONFLICT: store and pendingPayment differ",
              );
            }
            pendingRecord = manual;
          } else {
            pendingRequest = restorePendingPayment(
              stored.payment,
              options.allowHosts,
              paymentNetwork,
              options.allowInsecureLocalhost,
            );
            pendingRecord = stored;
            pendingFacts = inspectPendingPayment(
              pendingRequest,
              options.account.address,
              maxAmountAtomic,
              paymentNetwork,
            );
            assertPendingPaymentBindings(stored.payment, pendingFacts);
          }
          pendingPersisted = true;
        } else if (pendingRequest) {
          pendingFacts = inspectPendingPayment(
            pendingRequest,
            options.account.address,
            maxAmountAtomic,
            paymentNetwork,
          );
          pendingRecord = await pendingPaymentRecord(
            pendingRequest,
            paymentNetwork,
            pendingFacts,
          );
          pendingPersisted = false;
        }
        storeLoaded = true;
      })();
      await storeLoad;
    }
    if (pendingRequest && !pendingRecord) {
      pendingFacts ??= inspectPendingPayment(
        pendingRequest,
        options.account.address,
        maxAmountAtomic,
        paymentNetwork,
      );
      pendingRecord = await pendingPaymentRecord(
        pendingRequest,
        paymentNetwork,
        pendingFacts,
      );
    }
    if (pendingRequest && !pendingFacts) {
      pendingFacts = inspectPendingPayment(
        pendingRequest,
        options.account.address,
        maxAmountAtomic,
        paymentNetwork,
      );
    }
  }
}

async function runPayOperation<T>(
  operation: () => Promise<T>,
  phase: PayErrorPhase,
  fallbackCode: PayErrorCode,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw normalizePayError(error, phase, fallbackCode);
  }
}

function normalizePayError(
  error: unknown,
  fallbackPhase: PayErrorPhase,
  fallbackCode: PayErrorCode,
): PayError {
  if (error instanceof PayError) return error;
  const message = error instanceof Error ? error.message : "";
  if (/invalid payment challenge|malformed payment challenge/i.test(message)) {
    return new PayError(
      "PAYMENT_CHALLENGE_INVALID",
      "The payment challenge is malformed",
      { phase: "challenge", cause: error },
    );
  }
  const known: Array<{
    marker: string;
    code: PayErrorCode;
    phase: PayErrorPhase;
    retryable?: boolean;
  }> = [
    { marker: "PAY_HOST_DENIED", code: "PAY_HOST_DENIED", phase: "policy" },
    {
      marker: "PAY_INSECURE_TRANSPORT",
      code: "PAY_INSECURE_TRANSPORT",
      phase: "request",
    },
    {
      marker: "PAY_REDIRECT_DENIED",
      code: "PAYMENT_POLICY_DENIED",
      phase: "policy",
    },
    {
      marker: "PAYMENT_IN_PROGRESS",
      code: "PAYMENT_IN_PROGRESS",
      phase: "request",
      retryable: true,
    },
    {
      marker: "PAYMENT_RESUME_REQUIRED",
      code: "PAYMENT_RESUME_REQUIRED",
      phase: "recovery",
    },
    {
      marker: "PAYMENT_RESUME_UNAVAILABLE",
      code: "PAYMENT_RESUME_UNAVAILABLE",
      phase: "recovery",
    },
    {
      marker: "PENDING_PAYMENT_CLAIMED",
      code: "PENDING_PAYMENT_CLAIMED",
      phase: "recovery",
      retryable: true,
    },
    {
      marker: "PENDING_PAYMENT_CLEAR_CONFLICT",
      code: "PENDING_PAYMENT_CLEAR_CONFLICT",
      phase: "recovery",
    },
    {
      marker: "PENDING_PAYMENT_CONFLICT",
      code: "PENDING_PAYMENT_CONFLICT",
      phase: "recovery",
    },
    {
      marker: "PENDING_PAYMENT_POLICY_DENIED",
      code: "PAYMENT_POLICY_DENIED",
      phase: "policy",
    },
    {
      marker: "PENDING_PAYMENT_INVALID",
      code: "PENDING_PAYMENT_CORRUPT",
      phase: "recovery",
    },
    {
      marker: "PAYMENT_RECEIPT_MISSING",
      code: "PAYMENT_RECEIPT_MISSING",
      phase: "receipt",
    },
    {
      marker: "PAYMENT_RECEIPT_MISMATCH",
      code: "PAYMENT_RECEIPT_MISMATCH",
      phase: "receipt",
    },
    {
      marker: "PAYMENT_RECEIPT_UNVERIFIED",
      code: "PAYMENT_RECEIPT_UNVERIFIED",
      phase: "receipt",
      retryable: true,
    },
    {
      marker: "PAY_RECEIPT_RPC",
      code: "PAY_PROFILE_INVALID",
      phase: "configuration",
    },
    {
      marker: "PAY_SIGNER_UNSUPPORTED",
      code: "PAY_PROFILE_INVALID",
      phase: "configuration",
    },
  ];
  const match = known.find(({ marker }) => message.includes(marker));
  const code = match?.code ?? fallbackCode;
  const phase = match?.phase ?? fallbackPhase;
  const retryable = match?.retryable ?? code === "PAYMENT_SERVICE_UNAVAILABLE";
  return new PayError(code, publicErrorMessage(code), {
    phase,
    retryable,
    cause: error,
  });
}

function publicErrorMessage(code: PayErrorCode): string {
  return code
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (value) => value.toUpperCase());
}

async function paymentStatusUnknown(response: Response): Promise<PayError> {
  let paymentId: string | undefined;
  try {
    const value = (await response.clone().json()) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      "paymentId" in value &&
      typeof value.paymentId === "string"
    ) {
      paymentId = value.paymentId;
    }
  } catch {
    // Unknown responses may be empty or non-JSON. Recovery still stays pending.
  }
  return new PayError(
    "PAYMENT_STATUS_UNKNOWN",
    "Payment status is unknown; resume the saved request",
    {
      phase: "request",
      retryable: true,
      ...(paymentId ? { paymentId } : {}),
    },
  );
}

async function serializePendingPayment(
  requestInput: Request,
  network: BasePaymentNetwork,
  facts: PendingPaymentFacts,
): Promise<SerializedPendingPayment> {
  const request = requestInput.clone();
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const unsigned = {
    version: 3 as const,
    network,
    protocolId: protocolId(facts.protocol),
    adapterRevision: "pay-client-v1" as const,
    economicEffectDigest: economicEffectDigest(facts.effect),
    url: request.url,
    method: request.method,
    headers: Array.from(request.headers.entries()),
    ...(hasBody
      ? {
          bodyBase64: bytesToBase64(
            new Uint8Array(await request.arrayBuffer()),
          ),
        }
      : {}),
  };
  return {
    ...unsigned,
    requestDigest: pendingRequestDigest(unsigned),
  };
}

async function pendingPaymentRecord(
  request: Request,
  network: BasePaymentNetwork,
  facts: PendingPaymentFacts,
): Promise<PendingPaymentRecord> {
  const payment = await serializePendingPayment(request, network, facts);
  return {
    digest: pendingPaymentDigest(payment),
    payment,
  };
}

function pendingPaymentDigest(
  payment: SerializedPendingPayment,
): `0x${string}` {
  return payment.requestDigest;
}

async function assertPendingPaymentRecord(
  record: PendingPaymentRecord,
): Promise<void> {
  assertPendingPaymentVersion(record.payment);
  assertPendingPaymentChecksum(record.payment);
  if (record.payment.requestDigest !== record.digest) {
    throw new PayError(
      "PENDING_PAYMENT_CORRUPT",
      "Pending payment record digest does not match",
      { phase: "recovery" },
    );
  }
}

function pendingRequestDigest(
  payment: Omit<SerializedPendingPayment, "requestDigest">,
): `0x${string}` {
  return sha256(stringToBytes(JSON.stringify(payment)));
}

function assertPendingPaymentChecksum(payment: SerializedPendingPayment): void {
  const { requestDigest, ...unsigned } = payment;
  if (pendingRequestDigest(unsigned) !== requestDigest) {
    throw new PayError(
      "PENDING_PAYMENT_CORRUPT",
      "Pending payment record authentication binding does not match",
      { phase: "recovery" },
    );
  }
}

function assertPendingPaymentVersion(payment: SerializedPendingPayment): void {
  const candidate = payment as Partial<SerializedPendingPayment>;
  if (
    candidate.version !== 3 ||
    candidate.adapterRevision !== "pay-client-v1" ||
    (candidate.protocolId !== "x402-exact-v2-eip3009" &&
      candidate.protocolId !== "mpp-evm-charge-v0") ||
    typeof candidate.economicEffectDigest !== "string" ||
    !/^0x[0-9a-f]{64}$/.test(candidate.economicEffectDigest)
  ) {
    throw new PayError(
      "PENDING_PAYMENT_VERSION_UNSUPPORTED",
      "Pending payment record is not compatible with pay-client-v1",
      { phase: "recovery" },
    );
  }
}

function restorePendingPayment(
  pending: SerializedPendingPayment,
  allowHosts: string[],
  expectedNetwork: BasePaymentNetwork,
  allowInsecureLocalhost?: boolean,
): Request {
  assertPendingPaymentVersion(pending);
  if (pending.network !== expectedNetwork) {
    throw new PayError(
      "PENDING_PAYMENT_CONFLICT",
      "Pending payment belongs to another network",
      { phase: "recovery" },
    );
  }
  assertPendingPaymentChecksum(pending);
  assertSecureTransport(pending.url, allowInsecureLocalhost);
  if (!hostAllowed(pending.url, allowHosts)) {
    throw new Error(
      "PENDING_PAYMENT_INVALID: unsupported or untrusted request",
    );
  }
  const method = pending.method.toUpperCase();
  const headers = new Headers(pending.headers);
  if (!hasPaymentCredential(headers)) {
    throw new Error("PENDING_PAYMENT_INVALID: payment credential is missing");
  }
  const hasBody = method !== "GET" && method !== "HEAD";
  if (!hasBody && pending.bodyBase64 !== undefined) {
    throw new Error(
      "PENDING_PAYMENT_INVALID: GET or HEAD request cannot contain a body",
    );
  }
  return new Request(pending.url, {
    method,
    headers,
    redirect: "manual",
    ...(hasBody && pending.bodyBase64 !== undefined
      ? { body: base64ToBytes(pending.bodyBase64) }
      : {}),
  });
}

function protocolId(protocol: PayProtocol): PayProtocolId {
  return protocol === "x402" ? "x402-exact-v2-eip3009" : "mpp-evm-charge-v0";
}

function economicEffectDigest(effect: Eip3009EconomicEffect): `0x${string}` {
  return sha256(stringToBytes(JSON.stringify(effect)));
}

function assertPendingPaymentBindings(
  payment: SerializedPendingPayment,
  facts: PendingPaymentFacts,
): void {
  if (
    payment.protocolId !== protocolId(facts.protocol) ||
    payment.economicEffectDigest !== economicEffectDigest(facts.effect)
  ) {
    throw new PayError(
      "PENDING_PAYMENT_CORRUPT",
      "Pending payment protocol or economic-effect binding does not match",
      { phase: "recovery" },
    );
  }
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...value.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error("PENDING_PAYMENT_INVALID: body is not base64");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function displayUsdcToAtomic(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function supportedX402Requirement(network: string, asset: string): boolean {
  const canonical =
    network === "eip155:8453"
      ? "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
      : network === "eip155:84532"
        ? "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
        : undefined;
  return canonical !== undefined && asset.toLowerCase() === canonical;
}

function protocolOf(challenge: { id: string; realm: string }): PayProtocol {
  return challenge.realm === "x402" || challenge.id.startsWith("x402:")
    ? "x402"
    : "mpp";
}

function inspectPendingPayment(
  request: Request,
  accountAddress: string,
  maxAmountAtomic: bigint,
  paymentNetwork: BasePaymentNetwork,
): PendingPaymentFacts {
  try {
    const x402Header = request.headers.get("PAYMENT-SIGNATURE");
    const authorization = request.headers.get("Authorization");
    const mppHeader = authorization
      ? Credential.extractPaymentScheme(authorization)
      : null;
    if ((x402Header && mppHeader) || (!x402Header && !mppHeader)) {
      throw new Error("exactly one payment credential is required");
    }
    if (x402Header) {
      const payment = x402.Header.decodePaymentSignature(x402Header);
      const proof = x402.Types.ExactEip3009PayloadSchema.parse(payment.payload);
      const accepted = payment.accepted;
      if (accepted.network !== paymentNetwork) {
        throw new Error("x402 network does not match configured network");
      }
      const asset = baseUsdc(accepted.network);
      if (
        !asset ||
        !assets.matches(asset, getAddress(accepted.asset), accepted.network)
      ) {
        throw new Error("x402 asset is not canonical Base USDC");
      }
      const authorizationDomain = baseUsdcAuthorizationDomain(asset);
      if (getAddress(proof.authorization.from) !== getAddress(accountAddress)) {
        throw new Error("x402 payer does not match account");
      }
      if (
        proof.authorization.value !== accepted.amount ||
        getAddress(proof.authorization.to) !== getAddress(accepted.payTo)
      ) {
        throw new Error(
          "x402 authorization does not match accepted requirements",
        );
      }
      if (BigInt(accepted.amount) > maxAmountAtomic) {
        throw new Error("x402 amount exceeds maxAmount");
      }
      if (payment.resource?.url) {
        const resourceUrl = new URL(
          payment.resource.url,
          request.url,
        ).toString();
        if (resourceUrl !== request.url) {
          throw new Error("x402 resource does not match request URL");
        }
      }
      return {
        effect: createEip3009EconomicEffect({
          network: accepted.network,
          asset: accepted.asset,
          assetName: authorizationDomain.name,
          assetVersion: authorizationDomain.version,
          authorization: proof.authorization,
        }),
        protocol: "x402",
      };
    }

    const credential = Credential.deserialize(mppHeader!);
    if (
      credential.challenge.method !== EvmTypes.paymentMethod ||
      credential.challenge.intent !== EvmTypes.chargeIntent
    ) {
      throw new Error("MPP credential is not evm/charge");
    }
    const chargeRequest = EvmTypes.ChargeRequestSchema.parse(
      credential.challenge.request,
    );
    const proof = EvmTypes.AuthorizationPayloadSchema.parse(credential.payload);
    const network = EvmTypes.networkOf(chargeRequest.methodDetails.chainId);
    if (network !== paymentNetwork) {
      throw new Error("MPP network does not match configured network");
    }
    const asset = baseUsdc(network);
    if (
      !asset ||
      !assets.matches(asset, getAddress(chargeRequest.currency), network)
    ) {
      throw new Error("MPP asset is not canonical Base USDC");
    }
    const authorizationDomain = baseUsdcAuthorizationDomain(asset);
    if (getAddress(proof.from) !== getAddress(accountAddress)) {
      throw new Error("MPP payer does not match account");
    }
    if (
      proof.value !== chargeRequest.amount ||
      getAddress(proof.to) !== getAddress(chargeRequest.recipient) ||
      proof.nonce !== EvmTypes.challengeHash(credential.challenge)
    ) {
      throw new Error("MPP authorization does not match challenge");
    }
    if (BigInt(chargeRequest.amount) > maxAmountAtomic) {
      throw new Error("MPP amount exceeds maxAmount");
    }
    const realm = credential.challenge.realm.toLowerCase();
    const requestUrl = new URL(request.url);
    if (
      realm !== requestUrl.host.toLowerCase() &&
      realm !== requestUrl.hostname.toLowerCase() &&
      realm !== requestUrl.origin.toLowerCase()
    ) {
      throw new Error("MPP realm does not match request host");
    }
    return {
      effect: createEip3009EconomicEffect({
        network,
        asset: chargeRequest.currency,
        assetName: authorizationDomain.name,
        assetVersion: authorizationDomain.version,
        authorization: proof,
      }),
      protocol: "mpp",
    };
  } catch (error) {
    throw new Error(
      "PENDING_PAYMENT_POLICY_DENIED: signed request is not allowed",
      {
        cause: error,
      },
    );
  }
}

function baseUsdc(network: string) {
  if (network === "eip155:8453") return assets.base.USDC;
  if (network === "eip155:84532") return assets.baseSepolia.USDC;
  return undefined;
}

function baseUsdcAuthorizationDomain(
  asset: NonNullable<ReturnType<typeof baseUsdc>>,
): { name: string; version: string } {
  const { name, type, version } = asset.transfer;
  if (type !== "eip3009" || !name || !version) {
    throw new Error("Base USDC EIP-3009 domain metadata is missing");
  }
  return { name, version };
}

function decodeReceipt(response: Response): DecodedPaymentReceipt | undefined {
  const x402Header = response.headers.get(x402.paymentResponseHeader);
  if (x402Header) {
    const receipt = x402.Header.decodePaymentResponse(x402Header);
    if (!receipt.success) return undefined;
    return {
      ...(receipt.amount ? { amountAtomic: receipt.amount } : {}),
      receipt: {
        protocol: "x402",
        reference: receipt.transaction,
        status: "success",
        ...(receipt.payer ? { payer: receipt.payer } : {}),
        ...(receipt.network ? { network: receipt.network } : {}),
      },
    };
  }
  const paymentReceipt = response.headers.get("Payment-Receipt");
  if (!paymentReceipt) return undefined;
  const receipt = Receipt.deserialize(paymentReceipt);
  return {
    method: receipt.method,
    receipt: {
      protocol: "mpp",
      reference: receipt.reference,
      status: "success",
      timestamp: receipt.timestamp,
    },
  };
}

async function receiptMatches(
  decoded: DecodedPaymentReceipt,
  pending: PendingPaymentFacts,
  verifier: PaymentReceiptVerifier,
): Promise<boolean> {
  const receipt = decoded.receipt;
  if (receipt.protocol !== pending.protocol) return false;
  if (receipt.protocol === "mpp") {
    if (decoded.method !== EvmTypes.paymentMethod) return false;
  } else {
    if (receipt.network !== pending.effect.network) return false;
    if (
      decoded.amountAtomic !== undefined &&
      decoded.amountAtomic !== pending.effect.authorization.value
    ) {
      return false;
    }
    if (
      receipt.payer !== undefined &&
      getAddress(receipt.payer) !==
        getAddress(pending.effect.authorization.from)
    ) {
      return false;
    }
  }
  const verification: PaymentReceiptVerificationInput = {
    ...pending.effect,
    protocol: pending.protocol,
    transaction: receipt.reference,
  };
  return verifier(verification);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function receiptRpcUrl(
  options: CreatePayExecutorOptions,
  network: BasePaymentNetwork,
): string {
  const configured = options.rpcUrls?.[network];
  const value =
    configured ??
    (network === "eip155:84532" ? "https://sepolia.base.org" : undefined);
  if (!value) {
    throw new Error(
      "PAY_RECEIPT_RPC_REQUIRED: Base mainnet requires rpcUrls['eip155:8453'] or receiptVerifier",
    );
  }
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("PAY_RECEIPT_RPC_INVALID: receipt RPC must use HTTPS");
  }
  if (network === "eip155:8453" && url.hostname === "mainnet.base.org") {
    throw new Error(
      "PAY_RECEIPT_RPC_INVALID: Base public RPC is not for production use",
    );
  }
  return url.toString();
}

function hostAllowed(url: string, patterns: string[]): boolean {
  const host = new URL(url).host.toLowerCase();
  return patterns.some((rawPattern) => {
    const pattern = rawPattern.toLowerCase();
    if (!pattern.startsWith("*.")) return host === pattern;
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  });
}

function assertSecureTransport(
  url: string,
  allowInsecureLocalhost?: boolean,
): void {
  const parsed = new URL(url);
  if (parsed.protocol === "https:") return;
  const hostname = parsed.hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";
  if (parsed.protocol === "http:" && allowInsecureLocalhost && loopback) return;
  throw new Error(
    "PAY_INSECURE_TRANSPORT: HTTPS is required; HTTP is allowed only for explicit loopback development",
  );
}

function hasPaymentCredential(headers: Headers): boolean {
  const authorization = headers.get("Authorization");
  return (
    headers.has("PAYMENT-SIGNATURE") ||
    (authorization
      ? Credential.extractPaymentScheme(authorization) !== null
      : false)
  );
}
