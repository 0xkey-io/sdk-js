import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { ZeroXKeySDKClientBase } from "../__generated__/sdk-client-base";
import { StamperType, type StorageBase } from "../__types__";

// Regression test for activity polling: get_activity must query the
// organization the activity belongs to (for example a sub-organization that a
// parent organization key submitted for), not the session's or the client's
// default organization. Port of Turnkey sdk a1a94037.

const PARENT_ORG_ID = "parent-org-id";
const SUB_ORG_ID = "sub-org-id";
const API_BASE_URL = "https://api.example.com";
const SUBMIT_PATH = "/public/v1/submit/sign_raw_payload";

type RecordedRequest = { url: string; body: Record<string, unknown> };

// The submitted activity belongs to the sub-org and comes back in
// `submitStatus`; get_activity always returns it COMPLETED.
function stubFetch(submitStatus: string): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  const activity = {
    id: "activity-id",
    organizationId: SUB_ORG_ID,
    fingerprint: "fingerprint",
    type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
  };

  global.fetch = jest.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      requests.push({ url: path, body: JSON.parse(String(init?.body)) });

      let payload: unknown;
      if (path.endsWith("/query/get_mfa_status")) {
        payload = { mfaStatuses: [{ authenticatorId: "authenticator-id" }] };
      } else if (path.endsWith("/query/get_activity")) {
        payload = {
          activity: {
            ...activity,
            status: "ACTIVITY_STATUS_COMPLETED",
            result: {},
          },
        };
      } else {
        payload = { activity: { ...activity, status: submitStatus } };
      }

      return new Response(JSON.stringify(payload), { status: 200 });
    },
  ) as typeof fetch;

  return requests;
}

// Without a storageManager there is no active session to fall back to; with
// one, the session belongs to the parent organization.
function createClient({
  onMfaRequired,
  sessionOrganizationId,
}: {
  onMfaRequired?: () => Promise<void>;
  sessionOrganizationId?: string;
} = {}) {
  const storageManager = sessionOrganizationId
    ? ({
        getActiveSession: async () => ({
          organizationId: sessionOrganizationId,
        }),
      } as unknown as StorageBase)
    : undefined;

  return new ZeroXKeySDKClientBase({
    apiBaseUrl: API_BASE_URL,
    organizationId: PARENT_ORG_ID,
    apiKeyStamper: {
      stamp: async () => ({
        stampHeaderName: "X-Stamp",
        stampHeaderValue: "stamp",
      }),
    },
    defaultStamperType: StamperType.ApiKey,
    activityPoller: { intervalMs: 0, numRetries: 3 },
    ...(storageManager ? { storageManager } : {}),
    ...(onMfaRequired ? { onMfaRequired } : {}),
  });
}

function getActivityOrganizationIds(requests: RecordedRequest[]) {
  return requests
    .filter((r) => r.url.endsWith("/query/get_activity"))
    .map((r) => r.body.organizationId);
}

describe("pollForCompletion", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("polls the activity's organization when there is no active session", async () => {
    const requests = stubFetch("ACTIVITY_STATUS_PENDING");

    await createClient().activity(
      SUBMIT_PATH,
      { organizationId: SUB_ORG_ID, parameters: {} },
      "signRawPayloadResult",
    );

    expect(getActivityOrganizationIds(requests)).toEqual([SUB_ORG_ID]);
  });

  it("polls the activity's organization instead of the session's organization", async () => {
    const requests = stubFetch("ACTIVITY_STATUS_PENDING");

    await createClient({ sessionOrganizationId: PARENT_ORG_ID }).activity(
      SUBMIT_PATH,
      { organizationId: SUB_ORG_ID, parameters: {} },
      "signRawPayloadResult",
    );

    expect(getActivityOrganizationIds(requests)).toEqual([SUB_ORG_ID]);
  });

  it("re-polls the activity's organization after onMfaRequired resolves", async () => {
    const requests = stubFetch("ACTIVITY_STATUS_AUTHENTICATORS_NEEDED");
    const onMfaRequired = jest.fn(async () => {});

    await createClient({ onMfaRequired }).activity(
      SUBMIT_PATH,
      { organizationId: SUB_ORG_ID, parameters: {} },
      "signRawPayloadResult",
    );

    expect(onMfaRequired).toHaveBeenCalledTimes(1);
    expect(getActivityOrganizationIds(requests)).toEqual([SUB_ORG_ID]);
  });

  it("polls the activity's organization for a pending signed request", async () => {
    const requests = stubFetch("ACTIVITY_STATUS_PENDING");

    await createClient().sendSignedRequest({
      url: `${API_BASE_URL}${SUBMIT_PATH}`,
      body: JSON.stringify({ organizationId: SUB_ORG_ID, parameters: {} }),
      stamp: { stampHeaderName: "X-Stamp", stampHeaderValue: "stamp" },
    });

    expect(getActivityOrganizationIds(requests)).toEqual([SUB_ORG_ID]);
  });
});
