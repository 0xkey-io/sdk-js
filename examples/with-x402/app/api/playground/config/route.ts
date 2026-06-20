import {
  envStatus,
  getCompanyAccount,
  getFacilitatorSignerAddress,
  json,
  PLAYGROUND,
} from "../_lib";

export const runtime = "nodejs";

export async function GET() {
  let buyer: string | undefined;
  let company: unknown;
  let facilitatorSigner: string | undefined;
  try {
    const companyAccount = await getCompanyAccount();
    buyer = companyAccount.account.address;
    company = {
      organizationId: companyAccount.organizationId,
      signWith: companyAccount.signWith,
      apiBaseUrl: companyAccount.apiBaseUrl,
    };
  } catch {
    // Env readiness is reported below; do not fail config discovery.
  }
  try {
    facilitatorSigner = getFacilitatorSignerAddress();
  } catch {
    // Env readiness is reported below; do not fail config discovery.
  }

  return json({
    ...PLAYGROUND,
    organizationId: PLAYGROUND.organizationId,
    buyer,
    company,
    facilitatorSigner,
    env: envStatus(),
  });
}
