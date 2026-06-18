import { randomBytes } from "node:crypto";
import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAccount } from "@0xkey-io/viem";
import { ApiKeyStamper, ZeroXKeyServerClient } from "@0xkey-io/sdk-server";
import { baseSepolia } from "viem/chains";
import { createPayClient } from "@0xkey-io/pay";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@0xkey-io/pay";

const zeroXKeyEnv =
  process.env.ZEROXKEY_ENV ?? process.env.NEXT_PUBLIC_ZEROXKEY_ENV ?? "local";
const usesStagingWalletApi = zeroXKeyEnv === "staging";

export const PLAYGROUND = {
  network: "eip155:84532",
  chainId: 84532,
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Hex,
  seller:
    (process.env.NEXT_PUBLIC_RESOURCE_WALLET_ADDRESS as Hex | undefined) ??
    ("0xfB65e93108ac2bA9a5e7A997F8080b40eA551104" as Hex),
  amountAtomic: "1",
  resource:
    process.env.NEXT_PUBLIC_PAY_RESOURCE_URL ??
    "https://pay.0xkey.io/test/tiny-settlement",
  facilitatorUrl:
    process.env.NEXT_PUBLIC_FACILITATOR_URL ??
    process.env.FACILITATOR_URL ??
    "http://localhost:8090",
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
  organizationId:
    process.env.PAY_ORGANIZATION_ID ??
    process.env.ZEROXKEY_ORGANIZATION_ID ??
    process.env.COMPANY_ORGANIZATION_ID ??
    process.env.NEXT_PUBLIC_ORGANIZATION_ID,
  apiKey: process.env.FACILITATOR_API_KEY ?? process.env.ZEROXKEY_PAY_API_KEY,
};

export type PlaygroundScenario =
  | "success"
  | "invalid-domain"
  | "insufficient-balance";
export type PlaygroundMode = "company" | "local";

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function version() view returns (string)",
]);

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function envStatus() {
  return {
    hasCompanyOrganizationId: Boolean(companyOrganizationId()),
    hasCompanyApiPublicKey: Boolean(process.env.ZEROXKEY_API_PUBLIC_KEY),
    hasCompanyApiPrivateKey: Boolean(process.env.ZEROXKEY_API_PRIVATE_KEY),
    hasCompanySignWith: Boolean(companySignWith()),
    hasCompanyEthereumAddress: Boolean(companyEthereumAddress()),
    hasBuyerPrivateKey: Boolean(process.env.BUYER_PRIVATE_KEY),
    hasFacilitatorPrivateKey: Boolean(process.env.X402_RS_EVM_PRIVATE_KEY),
    hasRpcUrl: Boolean(process.env.BASE_SEPOLIA_RPC_URL),
    hasPayOrganizationId: Boolean(PLAYGROUND.organizationId),
    hasPayApiKey: Boolean(PLAYGROUND.apiKey),
    usesStagingWalletApi,
  };
}

function companyOrganizationId() {
  return (
    process.env.ZEROXKEY_ORGANIZATION_ID ??
    process.env.COMPANY_ORGANIZATION_ID ??
    process.env.NEXT_PUBLIC_ORGANIZATION_ID
  );
}

function companySignWith() {
  return (
    process.env.ZEROXKEY_SIGN_WITH ??
    process.env.COMPANY_WALLET_SIGN_WITH ??
    process.env.COMPANY_WALLET_ACCOUNT_ADDRESS
  );
}

function companyEthereumAddress() {
  return (
    process.env.ZEROXKEY_ETHEREUM_ADDRESS ??
    process.env.COMPANY_WALLET_ACCOUNT_ADDRESS
  );
}

function companyApiBaseUrl() {
  return (
    process.env.ZEROXKEY_API_BASE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    (usesStagingWalletApi ? "https://api.staging.0xkey.io" : undefined) ??
    "https://api.0xkey.io"
  );
}

function getLocalBuyerAccount() {
  const privateKey =
    (process.env.BUYER_PRIVATE_KEY as Hex | undefined) ??
    (process.env.X402_RS_EVM_PRIVATE_KEY as Hex | undefined);
  if (!privateKey) {
    throw new Error("Missing BUYER_PRIVATE_KEY or X402_RS_EVM_PRIVATE_KEY");
  }
  return privateKeyToAccount(privateKey);
}

export async function getCompanyAccount() {
  const organizationId = companyOrganizationId();
  const signWith = companySignWith();
  const apiPublicKey = process.env.ZEROXKEY_API_PUBLIC_KEY;
  const apiPrivateKey = process.env.ZEROXKEY_API_PRIVATE_KEY;
  if (!organizationId) throw new Error("Missing ZEROXKEY_ORGANIZATION_ID");
  if (!signWith) throw new Error("Missing ZEROXKEY_SIGN_WITH");
  if (!apiPublicKey) throw new Error("Missing ZEROXKEY_API_PUBLIC_KEY");
  if (!apiPrivateKey) throw new Error("Missing ZEROXKEY_API_PRIVATE_KEY");

  const stamper = new ApiKeyStamper({ apiPublicKey, apiPrivateKey });
  const client = new ZeroXKeyServerClient({
    apiBaseUrl: companyApiBaseUrl(),
    organizationId,
    stamper,
  });
  const account = await createAccount({
    client,
    organizationId,
    signWith,
    ethereumAddress: companyEthereumAddress(),
  });
  return {
    account,
    organizationId,
    signWith,
    apiBaseUrl: companyApiBaseUrl(),
  };
}

export function getFacilitatorSignerAddress(): Hex | undefined {
  const privateKey = process.env.X402_RS_EVM_PRIVATE_KEY as Hex | undefined;
  if (!privateKey) return undefined;
  return privateKeyToAccount(privateKey).address;
}

export function publicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(PLAYGROUND.rpcUrl),
  });
}

export async function readBalances(buyerOverride?: Hex) {
  const client = publicClient();
  const buyer =
    buyerOverride ??
    (envStatus().hasCompanySignWith && envStatus().hasCompanyApiPublicKey
      ? ((companyEthereumAddress() ?? companySignWith()) as Hex)
      : getLocalBuyerAccount().address);
  const facilitatorSigner = getFacilitatorSignerAddress();
  const [buyerUsdc, sellerUsdc, usdcName, usdcVersion, signerEth] =
    await Promise.all([
      client.readContract({
        address: PLAYGROUND.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [buyer],
      }),
      client.readContract({
        address: PLAYGROUND.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [PLAYGROUND.seller],
      }),
      client.readContract({
        address: PLAYGROUND.usdc,
        abi: erc20Abi,
        functionName: "name",
      }),
      client.readContract({
        address: PLAYGROUND.usdc,
        abi: erc20Abi,
        functionName: "version",
      }),
      facilitatorSigner
        ? client.getBalance({ address: facilitatorSigner })
        : Promise.resolve(BigInt(0)),
    ]);

  return {
    buyer,
    seller: PLAYGROUND.seller,
    facilitatorSigner,
    buyerUsdc: buyerUsdc.toString(),
    sellerUsdc: sellerUsdc.toString(),
    facilitatorSignerEthWei: signerEth.toString(),
    usdcName,
    usdcVersion,
  };
}

export function requirementsFor(amountAtomic: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: PLAYGROUND.network,
    amount: amountAtomic,
    asset: PLAYGROUND.usdc,
    payTo: PLAYGROUND.seller,
    maxTimeoutSeconds: 300,
    resource: PLAYGROUND.resource,
    extra: { name: "USDC", version: "2" },
  };
}

export async function buildPaymentRequest(opts?: {
  scenario?: PlaygroundScenario;
  amountAtomic?: string;
  mode?: PlaygroundMode;
}): Promise<{
  x402Version: 2;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}> {
  const scenario = opts?.scenario ?? "success";
  const mode = opts?.mode ?? "company";
  const account =
    mode === "company"
      ? (await getCompanyAccount()).account
      : getLocalBuyerAccount();
  const now = Math.floor(Date.now() / 1000);
  const amountAtomic =
    opts?.amountAtomic ??
    (scenario === "insufficient-balance"
      ? "999999999999999999999999"
      : PLAYGROUND.amountAtomic);
  const requirements = requirementsFor(amountAtomic);
  const authorization = {
    from: account.address,
    to: PLAYGROUND.seller,
    value: amountAtomic,
    validAfter: String(now - 60),
    validBefore: String(now + 300),
    nonce: `0x${randomBytes(32).toString("hex")}` as Hex,
  };
  const domainName = scenario === "invalid-domain" ? "USD Coin" : "USDC";
  const typedMessage = {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  };
  const signature = await account.signTypedData({
    domain: {
      name: domainName,
      version: "2",
      chainId: PLAYGROUND.chainId,
      verifyingContract: PLAYGROUND.usdc,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: typedMessage,
  });

  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      scheme: "exact",
      network: PLAYGROUND.network,
      accepted: requirements,
      payload: { signature, authorization },
    },
    paymentRequirements: requirements,
  };
}

async function postFacilitator<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (PLAYGROUND.organizationId) {
    headers["x-0xkey-organization-id"] = PLAYGROUND.organizationId;
  }
  if (PLAYGROUND.apiKey) {
    headers.authorization = `Bearer ${PLAYGROUND.apiKey}`;
  }
  const response = await fetch(
    `${PLAYGROUND.facilitatorUrl.replace(/\/$/, "")}/${path}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
  return (await response.json()) as T;
}

export async function verifyPayment(body: unknown): Promise<VerifyResponse> {
  return postFacilitator<VerifyResponse>("verify", body);
}

export async function settlePayment(body: unknown): Promise<SettleResponse> {
  return postFacilitator<SettleResponse>("settle", body);
}

export async function queryRecords(txHash: string) {
  if (!PLAYGROUND.organizationId) {
    throw new Error("Missing PAY_ORGANIZATION_ID or ZEROXKEY_ORGANIZATION_ID");
  }
  const client = createPayClient({
    baseUrl: PLAYGROUND.facilitatorUrl,
    apiKey: PLAYGROUND.apiKey,
  });
  return client.payments.list({
    organizationId: PLAYGROUND.organizationId,
    txHash,
    limit: 10,
  });
}
