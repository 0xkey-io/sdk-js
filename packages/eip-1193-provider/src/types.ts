import type { ZeroXKeyClient } from "@0xkey-io/http";
import type { ZeroXKeyBrowserClient } from "@0xkey-io/sdk-browser";
import type { UUID } from "crypto";
import type {
  AddEthereumChainParameter,
  Address,
  Chain,
  EIP1193Provider,
  EIP1193RequestFn,
  EIP1474Methods,
  Hash,
  TypedDataDefinition,
} from "viem";

export type ZeroXKeyEIP1193ProviderOptions = {
  walletId: UUID;
  organizationId: UUID;
  zeroXKeyClient: ZeroXKeyClient | ZeroXKeyBrowserClient;
  chains: AddEthereumChainParameter[];
};

export type ZeroXKeyEIP1193Provider = Omit<EIP1193Provider, "request"> & {
  request: EIP1193RequestFn<
    [
      ...EIP1474Methods,
      {
        Method: "eth_signTypedData_v4";
        Parameters: [address: Address, typedData: TypedDataDefinition];
        ReturnType: Promise<Hash>;
      },
    ]
  >;
};

export type ProviderChain = Omit<Chain, "nativeCurrency"> & {
  nativeCurrency?: Chain["nativeCurrency"] | undefined;
};

export type HTTPSUrl = `https://${string}`;

export type WalletAddEthereumChain = Omit<
  AddEthereumChainParameter,
  "rpcUrls" | "blockExplorerUrls"
> & {
  rpcUrls: [string, ...string[]];
  blockExplorerUrls: [HTTPSUrl, ...HTTPSUrl[]] | null;
};

export interface ConnectInfo {
  chainId: string;
}

export type TransactionType =
  | "legacy"
  | "eip2930"
  | "eip1559"
  | "eip4844"
  | "eip7702"
  | undefined;
