import type { ZeroXKeySDKClientConfig, AuthClient } from "@types";
import { ZeroXKeySDKClientBase } from "../__generated__/sdk-client-base";

export abstract class ZeroXKeyBaseClient extends ZeroXKeySDKClientBase {
  authClient?: AuthClient | undefined;

  constructor(config: ZeroXKeySDKClientConfig, authClient?: AuthClient) {
    super(config);
    this.authClient = authClient;
  }
}
