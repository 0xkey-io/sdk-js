import { ZeroXKey } from "@0xkey-io/sdk-server";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

/**
 * Demonstrates 0xkey's custodial `tronSendTransaction`: the Coordinator
 * builds the unsigned transaction (via TronGrid), runs it through policy,
 * signs it in the enclave, broadcasts it, and polls for on-chain status —
 * all server-side, with no client-side TronWeb usage required.
 *
 * Native TRX transfer: only `value` (in sun) is set.
 * TRC-20 transfer: set `contractAddress` + `tokenAmount` (atomic units);
 * `value` is ignored server-side in that case.
 *
 * Prerequisite: `TRON_ADDRESS` must be an activated Nile testnet account
 * (fund it once via https://nileex.io/join/getJoinPage — "Get 2000 test
 * coins" / "Get 1000 USDT test tokens"). An unfunded address has no
 * on-chain presence yet, so TronGrid's `createtransaction` will reject it
 * with `ContractValidateException: ... no OwnerAccount`.
 */
async function pollStatus(
  zeroXKeyClient: ZeroXKey,
  sendTransactionStatusId: string,
) {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await zeroXKeyClient
      .apiClient()
      .getSendTransactionStatus({ sendTransactionStatusId });
    console.log(`  [poll ${i}]`, JSON.stringify(status));
    if (!/pending/i.test(status.txStatus ?? "")) return status;
  }
  return undefined;
}

async function main() {
  const zeroXKeyClient = new ZeroXKey({
    apiBaseUrl: "https://api.0xkey.com",
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });

  const from = process.env.TRON_ADDRESS!; // your ZeroXKey Tron address
  const to = process.env.TRON_RECIPIENT || "TY1jfzP3s94oSzYECC89EFn17iA8S4imVZ";
  // Nile USDT (Tether) test token contract used by the faucet.
  const usdtContract = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";

  console.log("=== Native TRX transfer via tronSendTransaction ===");
  try {
    const trxStatusId = await zeroXKeyClient.apiClient().tronSendTransaction({
      organizationId: process.env.ORGANIZATION_ID!,
      from,
      to,
      caip2: "tron:0xcd8690dc", // Nile testnet
      value: "100", // sun
    });
    console.log("sendTransactionStatusId:", trxStatusId);
    await pollStatus(zeroXKeyClient, trxStatusId);
  } catch (e: any) {
    console.log("TRX send failed:", e.message);
  }

  console.log("\n=== TRC-20 (USDT) transfer via tronSendTransaction ===");
  try {
    const trc20StatusId = await zeroXKeyClient
      .apiClient()
      .tronSendTransaction({
        organizationId: process.env.ORGANIZATION_ID!,
        from,
        to,
        caip2: "tron:0xcd8690dc", // Nile testnet
        contractAddress: usdtContract,
        tokenAmount: "1000000", // 1 USDT (6 decimals)
      });
    console.log("sendTransactionStatusId:", trc20StatusId);
    await pollStatus(zeroXKeyClient, trc20StatusId);
  } catch (e: any) {
    console.log("TRC-20 send failed:", e.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
