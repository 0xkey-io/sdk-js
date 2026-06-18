// USDC address on Base Sepolia
export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// 0.000001 USDC (6 decimals) for local Base Sepolia smoke tests.
export const PAYMENT_AMOUNT = "1";

// Cookie timeout
export const COOKIE_TIMEOUT_SECONDS = 300;

const defaultResource = "https://pay.0xkey.io/test/tiny-settlement";

// Payment requirements (x402 v2)
export const PAYMENT_REQUIREMENTS = {
  scheme: "exact" as const,
  network: "eip155:84532",
  amount: PAYMENT_AMOUNT,
  resource: process.env.NEXT_PUBLIC_PAY_RESOURCE_URL ?? defaultResource,
  description: "Access to 0xkey Pay Playground protected content",
  mimeType: "text/html",
  payTo: process.env.NEXT_PUBLIC_RESOURCE_WALLET_ADDRESS!,
  maxTimeoutSeconds: COOKIE_TIMEOUT_SECONDS,
  asset: USDC_ADDRESS,
  extra: { name: "USDC", version: "2" },
};
