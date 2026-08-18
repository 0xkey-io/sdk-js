import { ApiKeyStamper, ZeroXKeyServerClient } from "@0xkey-io/sdk-server";
import { createAccount } from "@0xkey-io/viem";
import { createPayFetch, type PayProtocol } from "@0xkey-io/pay/client";
import { Challenge, x402 } from "mppx";
import { getAddress } from "viem";
import { createFilePendingPaymentStore } from "./file-store.js";

const network = "eip155:84532";
const asset = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const amountAtomic = "1000";
const amountDisplay = "0.001 USDC";

const command = process.argv[2];
if (!command || !["quote", "pay", "resume"].includes(command)) {
  throw new Error(
    "Usage: pnpm --filter pay-v1-uat buyer quote|pay|resume [x402|mpp]",
  );
}
const endpoint = requireUrl("PAY_UAT_ENDPOINT");
const payTo = getAddress(requireEnv("ZEROXKEY_PAY_TO"));

if (command === "quote") {
  await printQuote(endpoint, payTo);
  process.exit(0);
}

const protocol =
  command === "pay" ? requireProtocol(process.argv[3]) : undefined;
const signWith = requireEnv("ZEROXKEY_SIGN_WITH");
const ethereumAddress = getAddress(requireEnv("ZEROXKEY_ETHEREUM_ADDRESS"));

if (command === "pay" && protocol) {
  const confirmation = `I_CONFIRM_${protocol.toUpperCase()}_0.001_USDC_FROM_${ethereumAddress}_TO_${payTo}_ON_84532`;
  if (process.env.PAY_UAT_OPERATOR_CONFIRMATION !== confirmation) {
    await printQuote(endpoint, payTo, ethereumAddress, protocol);
    throw new Error(
      `Fresh confirmation required. Set PAY_UAT_OPERATOR_CONFIRMATION exactly to ${confirmation}`,
    );
  }
}

const organizationId = requireEnv("ZEROXKEY_ORGANIZATION_ID");
const apiPublicKey = requireEnv("ZEROXKEY_PUBLIC_KEY");
const apiPrivateKey = requireEnv("ZEROXKEY_PRIVATE_KEY");
const apiBaseUrl =
  process.env.ZEROXKEY_API_BASE_URL ?? "https://api.staging.0xkey.io";

const stamper = new ApiKeyStamper({ apiPublicKey, apiPrivateKey });
const client = new ZeroXKeyServerClient({
  apiBaseUrl,
  organizationId,
  stamper,
  activityPoller: { intervalMs: 1_000, numRetries: 20 },
});
const account = await createAccount({
  client,
  organizationId,
  signWith,
  ethereumAddress,
});
if (getAddress(account.address) !== ethereumAddress) {
  throw new Error(
    "Resolved 0xkey account does not match ZEROXKEY_ETHEREUM_ADDRESS",
  );
}

const store = createFilePendingPaymentStore({
  file: requireEnv("PAY_UAT_PENDING_FILE"),
  keyHex: requireEnv("PAY_UAT_STORE_KEY"),
});
const payFetch = createPayFetch({
  account,
  allowHosts: [endpoint.host],
  environment: "sandbox",
  maxAmount: "$0.001",
  protocolPreference: protocol ? [protocol] : ["x402", "mpp"],
  pendingPaymentStore: store,
  allowInsecureLocalhost: isLoopbackHttp(endpoint),
  rpcUrls: {
    "eip155:84532":
      process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
  },
});

const response =
  command === "resume" ? await payFetch.resume() : await payFetch(endpoint);
const body = await response.text();
console.info("pay_v1_uat_result", {
  body: parsePublicBody(body),
  protocol: protocol ?? "stored credential",
  status: response.status,
});
if (!response.ok) process.exitCode = 1;

async function printQuote(
  url: URL,
  expectedPayTo: `0x${string}`,
  payer?: `0x${string}`,
  selectedProtocol?: PayProtocol,
) {
  const response = await fetch(url);
  if (response.status !== 402) {
    throw new Error(
      `Expected merchant 402 challenge, received ${response.status}`,
    );
  }
  const encodedX402 = response.headers.get("payment-required");
  if (!encodedX402) throw new Error("Merchant did not advertise x402");
  const paymentRequired = x402.Header.decodePaymentRequired(encodedX402);
  const accepted = paymentRequired.accepts.find(
    (candidate) =>
      candidate.scheme === "exact" && candidate.network === network,
  );
  if (!accepted)
    throw new Error("Merchant did not advertise Base Sepolia x402 exact");
  assertTerms(
    {
      amount: accepted.amount,
      asset: accepted.asset,
      network: accepted.network,
      payTo: accepted.payTo,
    },
    expectedPayTo,
  );

  const challenge = Challenge.fromResponse(response.clone());
  if (challenge.method !== "evm" || challenge.intent !== "charge") {
    throw new Error("Merchant did not advertise MPP evm/charge");
  }
  const request = challenge.request as Record<string, unknown>;
  const methodDetails = request.methodDetails as Record<string, unknown>;
  assertTerms(
    {
      amount: request.amount,
      asset: request.currency,
      network: `eip155:${String(methodDetails.chainId)}`,
      payTo: request.recipient,
    },
    expectedPayTo,
  );

  console.info("PAYMENT_CONFIRMATION_REQUIRED", {
    amount: amountDisplay,
    asset,
    endpoint: url.toString(),
    network,
    payTo: expectedPayTo,
    payer: payer ?? "not loaded for quote-only mode",
    protocol: selectedProtocol ?? "choose x402 or mpp; confirm separately",
  });
}

function assertTerms(
  terms: {
    amount: unknown;
    asset: unknown;
    network: unknown;
    payTo: unknown;
  },
  expectedPayTo: `0x${string}`,
) {
  if (
    terms.amount !== amountAtomic ||
    typeof terms.asset !== "string" ||
    getAddress(terms.asset) !== asset ||
    terms.network !== network ||
    typeof terms.payTo !== "string" ||
    getAddress(terms.payTo) !== expectedPayTo
  ) {
    throw new Error(
      "Merchant challenge does not match fixed UAT payment terms",
    );
  }
}

function requireProtocol(value: string | undefined): PayProtocol {
  if (value !== "x402" && value !== "mpp") {
    throw new Error("Protocol must be x402 or mpp");
  }
  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireUrl(name: string): URL {
  const url = new URL(requireEnv(name));
  if (url.protocol !== "https:" && !isLoopbackHttp(url)) {
    throw new Error(`${name} must use HTTPS or exact loopback HTTP`);
  }
  return url;
}

function isLoopbackHttp(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}

function parsePublicBody(body: string): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return { length: body.length, type: "non-json" };
  }
}
