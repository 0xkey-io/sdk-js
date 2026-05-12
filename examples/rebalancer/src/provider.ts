import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";

import { ZeroXKeySigner } from "@0xkey-io/ethers";
import { ZeroXKey as ZeroXKeySDKServer } from "@0xkey-io/sdk-server";

import { Environment } from "./utils";

const DEFAULT_INFURA_COMMUNITY_KEY = "84842078b09946638c03157f83405213";
const DEFAULT_ENV = Environment.SEPOLIA;

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

let provider = new ethers.InfuraProvider(
  DEFAULT_ENV,
  process.env.INFURA_KEY || DEFAULT_INFURA_COMMUNITY_KEY,
);

export function getProvider(env = Environment.SEPOLIA): ethers.Provider {
  if (env !== Environment.SEPOLIA) {
    provider = new ethers.InfuraProvider(
      env,
      process.env.INFURA_KEY || DEFAULT_INFURA_COMMUNITY_KEY,
    );
  }

  return provider;
}

// getZeroXKeySigner returns a ZeroXKeySigner connected to the passed-in Provider
// (https://docs.ethers.org/v6/api/providers/)
export function getZeroXKeySigner(
  provider: ethers.Provider,
  signWith: string,
): ZeroXKeySigner {
  const zeroXKeyClient = new ZeroXKeySDKServer({
    apiBaseUrl: "https://api.0xkey.com",
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });

  // Initialize a ZeroXKey Signer
  // TODO: Update this once @0xkey-io/ethers supports sdk-server types
  const zeroXKeySigner = new ZeroXKeySigner({
    client: zeroXKeyClient.apiClient(),
    organizationId: process.env.ORGANIZATION_ID!,
    signWith,
  });

  return zeroXKeySigner.connect(provider);
}
