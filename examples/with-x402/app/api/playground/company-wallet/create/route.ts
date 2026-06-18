import {
  ApiKeyStamper,
  defaultEthereumAccountAtIndex,
  ZeroXKeyServerClient,
} from "@0xkey-io/sdk-server";
import { createAccount } from "@0xkey-io/viem";
import type { Hex } from "viem";
import { PLAYGROUND, json } from "../../_lib";

export const runtime = "nodejs";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function assertLocalRequest(req: Request) {
  const url = new URL(req.url);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Company wallet creation is only available on localhost");
  }
  if (process.env.ALLOW_COMPANY_WALLET_CREATE !== "true") {
    throw new Error("Set ALLOW_COMPANY_WALLET_CREATE=true to create a wallet");
  }
}

export async function POST(req: Request) {
  try {
    assertLocalRequest(req);

    const organizationId = requireEnv("ZEROXKEY_ORGANIZATION_ID");
    const apiPublicKey = requireEnv("ZEROXKEY_API_PUBLIC_KEY");
    const apiPrivateKey = requireEnv("ZEROXKEY_API_PRIVATE_KEY");
    const apiBaseUrl =
      process.env.ZEROXKEY_API_BASE_URL ?? "https://api.staging.0xkey.io";

    const stamper = new ApiKeyStamper({ apiPublicKey, apiPrivateKey });
    const client = new ZeroXKeyServerClient({
      apiBaseUrl,
      organizationId,
      stamper,
      activityPoller: { intervalMs: 1000, numRetries: 10 },
    });

    const walletName =
      process.env.COMPANY_WALLET_NAME ??
      `0xkey-pay-playground-${new Date().toISOString()}`;
    const wallet = await client.createWallet({
      organizationId,
      walletName,
      accounts: [defaultEthereumAccountAtIndex(0)],
    });
    const address = wallet.addresses?.[0] as Hex | undefined;
    if (!address) throw new Error("Create wallet returned no Ethereum address");

    const account = await createAccount({
      client,
      organizationId,
      signWith: address,
    });

    const signature = await account.signTypedData({
      domain: {
        name: "USDC",
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
      message: {
        from: address,
        to: PLAYGROUND.seller,
        value: BigInt(PLAYGROUND.amountAtomic),
        validAfter: 0n,
        validBefore: BigInt(Math.floor(Date.now() / 1000) + 300),
        nonce:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
      },
    });

    return json({
      walletId: wallet.walletId,
      address,
      signWith: address,
      apiBaseUrl,
      organizationId,
      signaturePrefix: `${signature.slice(0, 10)}...${signature.slice(-8)}`,
      nextEnv: {
        ZEROXKEY_SIGN_WITH: address,
        ZEROXKEY_ETHEREUM_ADDRESS: address,
      },
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "unknown error" },
      500,
    );
  }
}
