import * as core from "../../../../../packages/core/dist/index";
import {
  OtpType,
  ZeroXKeyClient,
  getClientParams,
  type ZeroXKeySDKClientConfig,
} from "../../../../../packages/core/dist/index";

const config: ZeroXKeySDKClientConfig = {
  organizationId: "00000000-0000-0000-0000-000000000000",
  authProxyConfigId: "00000000-0000-0000-0000-000000000000",
};

const client: ZeroXKeyClient = new ZeroXKeyClient(config);
const otpType: OtpType = OtpType.Email;

async function demo() {
  return getClientParams(config.authProxyConfigId ?? "");
}

export { client, core, demo, otpType };
