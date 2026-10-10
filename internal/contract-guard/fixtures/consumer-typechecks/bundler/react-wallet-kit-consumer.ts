import * as reactWalletKit from "../../../../../packages/react-wallet-kit/dist/index";
import {
  ZeroXKeyProvider,
  useZeroXKey,
  type ZeroXKeyProviderConfig,
} from "../../../../../packages/react-wallet-kit/dist/index";

const config: ZeroXKeyProviderConfig = {
  organizationId: "00000000-0000-0000-0000-000000000000",
  authProxyConfigId: "00000000-0000-0000-0000-000000000000",
};

const provider: typeof ZeroXKeyProvider = ZeroXKeyProvider;
const hook: typeof useZeroXKey = useZeroXKey;

export { config, hook, provider, reactWalletKit };
