import React, { createContext, useContext, useState, useEffect } from "react";

import { createActivityPoller, type ZeroXKeyClient } from "@0xkey-io/http";

import {
  TStamper,
  WalletInterface,
  WalletStamper,
} from "@0xkey-io/wallet-stamper";
import { createWebauthnStamper, Email } from "@/lib/0xkey";
import { createUserSubOrg, getSubOrgByPublicKey } from "@/lib/server";
import { ChainType } from "@/lib/types";

import { useRouter } from "next/navigation";
import { ACCOUNT_CONFIG_SOLANA } from "@/lib/constants";
import { User, Wallet } from "@/lib/types";

// Context for the ZeroXKeyClient
const ZeroXKeyContext = createContext<{
  client: ZeroXKeyClient | null;
  passkeyClient: ZeroXKeyClient | null;
  walletClient: ZeroXKeyClient | null;
  createSubOrg: (email?: Email, chainType?: ChainType) => Promise<void>;

  setWallet: (wallet: WalletInterface | null) => void;
  signInWithWallet: () => Promise<User | null>;
  getWallets: () => Promise<Wallet[]>;
  authenticating: boolean;
  user: User | null;
  createWallet: (walletName: string) => Promise<void>;
}>({
  client: null,
  passkeyClient: null,
  walletClient: null,
  createSubOrg: async () => {},

  setWallet: () => {},
  signInWithWallet: async () => null,
  getWallets: async () => [],
  authenticating: false,
  user: null,
  createWallet: async () => {},
});

export const useZeroXKey = () => useContext(ZeroXKeyContext);

interface ZeroXKeyProviderProps {
  children: React.ReactNode;
}

const clientConfig = {
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL!,
};

export const ZeroXKeyProvider: React.FC<ZeroXKeyProviderProps> = ({
  children,
}) => {
  const [wallet, setWallet] = useState<WalletInterface | null>(null);
  const [client, setClient] = useState<ZeroXKeyClient | null>(null);
  const [passkeyClient, setPasskeyClient] = useState<ZeroXKeyClient | null>(
    null,
  );
  const [walletClient, setWalletClient] = useState<ZeroXKeyClient | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [user, setUser] = useState<User | null>({
    organizationId: "",
    organizationName: "",
    userId: "",
    username: "",
  });

  const router = useRouter();

  const createZeroXKeyClient = async (stamper: TStamper) => {
    const { ZeroXKeyClient } = await import("@0xkey-io/http");

    return new ZeroXKeyClient(clientConfig, stamper);
  };

  useEffect(() => {
    if (wallet) {
      createZeroXKeyClient(new WalletStamper(wallet)).then(setWalletClient);
    }
  }, [wallet]);

  useEffect(() => {
    const initPasskeyClient = async () => {
      const webauthnStamper = await createWebauthnStamper({
        rpId: "localhost",
      });
      createZeroXKeyClient(webauthnStamper as TStamper).then(setPasskeyClient);
    };
    initPasskeyClient();
  }, []);

  async function createSubOrg(
    email?: Email,
    chainType: ChainType = ChainType.SOLANA,
  ) {
    setAuthenticating(true);
    const publicKey = await wallet?.getPublicKey();

    const res = await createUserSubOrg({
      email,
      publicKey,
      chainType,
    });

    setUser((prevUser) => ({
      ...prevUser,
      organizationId: res.subOrganizationId || "",
      organizationName: prevUser?.organizationName || "",
      userId: prevUser?.userId || "",
      username: prevUser?.username || "",
    }));

    setAuthenticating(false);
    router.push("/dashboard");
  }

  async function getWallets(): Promise<Wallet[]> {
    if (!walletClient || !user?.organizationId) {
      return [];
    }
    const { wallets } = await walletClient?.getWallets({
      organizationId: user?.organizationId,
    });

    return wallets as unknown as Wallet[];
  }

  async function signInWithWallet(): Promise<User | null> {
    const publicKey = await wallet?.getPublicKey();
    if (!publicKey) {
      return null;
    }
    const { organizationIds } = await getSubOrgByPublicKey(publicKey);
    const organizationId = organizationIds[0];

    let whoami: User | null = null;
    if (walletClient) {
      try {
        whoami = await walletClient.getWhoami({
          organizationId,
        });
        setUser(whoami);
        router.push("/dashboard");
      } catch (e) {
        console.error(e);
      }
    }
    return whoami;
  }

  async function createWallet(walletName: string) {
    if (!walletClient || !user?.organizationId) {
      return;
    }
    const activityPoller = createActivityPoller({
      client: walletClient,
      requestFn: walletClient.createWallet,
    });

    const completedActivity = await activityPoller({
      type: "ACTIVITY_TYPE_CREATE_WALLET",
      timestampMs: new Date().getTime().toString(),
      organizationId: user?.organizationId,
      parameters: {
        walletName,
        accounts: [ACCOUNT_CONFIG_SOLANA],
      },
    });
  }

  return (
    <ZeroXKeyContext.Provider
      value={{
        client,
        passkeyClient,
        walletClient,
        createSubOrg,
        setWallet,
        signInWithWallet,
        authenticating,
        user,
        getWallets,
        createWallet,
      }}
    >
      {children}
    </ZeroXKeyContext.Provider>
  );
};
