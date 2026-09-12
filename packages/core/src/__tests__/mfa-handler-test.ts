import { expect, jest, test } from "@jest/globals";
import { ZeroXKeySDKClientBase } from "../__generated__/sdk-client-base";

const response = (body: unknown) =>
  Promise.resolve({ ok: true, json: async () => body } as Response);

test("fetches MFA status, invokes the handler, then resumes polling", async () => {
  const onMfaRequired = jest.fn(async () => undefined);
  const fetchMock = jest
    .fn()
    .mockImplementationOnce(() =>
      response({
        activity: {
          id: "activity-1",
          organizationId: "org-1",
          fingerprint: "fingerprint-1",
          type: "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
          status: "ACTIVITY_STATUS_AUTHENTICATORS_NEEDED",
        },
      }),
    )
    .mockImplementationOnce(() =>
      response({
        mfaStatuses: [
          {
            mfaPolicyId: "policy-1",
            userId: "user-1",
            satisfied: false,
            satisfiedMethods: [],
            requiredMethods: [],
          },
        ],
      }),
    )
    .mockImplementationOnce(() =>
      response({
        activity: {
          id: "activity-1",
          organizationId: "org-1",
          type: "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
          status: "ACTIVITY_STATUS_COMPLETED",
          result: {},
        },
      }),
    );
  global.fetch = fetchMock as unknown as typeof fetch;

  const client = new ZeroXKeySDKClientBase({
    apiBaseUrl: "https://example.test",
    organizationId: "org-1",
    activityPoller: { intervalMs: 0, numRetries: 1 },
    onMfaRequired,
  });
  const result = await client.activity(
    "/public/v1/submit/test",
    { organizationId: "org-1" },
    "testResult",
  );

  expect(onMfaRequired).toHaveBeenCalledWith(
    expect.objectContaining({
      activityId: "activity-1",
      fingerprint: "fingerprint-1",
      organizationId: "org-1",
      activityStatus: "ACTIVITY_STATUS_AUTHENTICATORS_NEEDED",
    }),
  );
  expect((result as { activity: { status: string } }).activity.status).toBe(
    "ACTIVITY_STATUS_COMPLETED",
  );
});

test("returns the MFA pause unchanged when no handler is configured", async () => {
  global.fetch = jest.fn<() => Promise<Response>>().mockImplementationOnce(() =>
    response({
      activity: {
        id: "activity-2",
        organizationId: "org-1",
        type: "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
        status: "ACTIVITY_STATUS_AUTHENTICATORS_NEEDED",
      },
    }),
  ) as unknown as typeof fetch;
  const client = new ZeroXKeySDKClientBase({
    apiBaseUrl: "https://example.test",
    organizationId: "org-1",
  });

  const result = await client.activity(
    "/public/v1/submit/test",
    {},
    "testResult",
  );
  expect((result as { activity: { status: string } }).activity.status).toBe(
    "ACTIVITY_STATUS_AUTHENTICATORS_NEEDED",
  );
});

test("handles consensus MFA before spending the ordinary polling budget", async () => {
  const calls: string[] = [];
  const onMfaRequired = jest.fn(async () => {
    calls.push("handler");
  });
  global.fetch = jest
    .fn<() => Promise<Response>>()
    .mockImplementationOnce(() =>
      response({
        activity: {
          id: "activity-3",
          organizationId: "org-1",
          fingerprint: "fingerprint-3",
          type: "ACTIVITY_TYPE_APPROVE_ACTIVITY",
          status: "ACTIVITY_STATUS_CONSENSUS_NEEDED",
        },
      }),
    )
    .mockImplementationOnce(() => {
      calls.push("mfa-status");
      return response({
        mfaStatuses: [
          {
            mfaPolicyId: "policy-1",
            userId: "user-1",
            satisfied: false,
            satisfiedMethods: [],
            requiredMethods: [],
          },
        ],
      });
    })
    .mockImplementationOnce(() => {
      calls.push("poll");
      return response({
        activity: {
          id: "activity-3",
          organizationId: "org-1",
          type: "ACTIVITY_TYPE_APPROVE_ACTIVITY",
          status: "ACTIVITY_STATUS_COMPLETED",
          result: {},
        },
      });
    }) as unknown as typeof fetch;
  const client = new ZeroXKeySDKClientBase({
    apiBaseUrl: "https://example.test",
    organizationId: "org-1",
    activityPoller: { intervalMs: 0, numRetries: 1 },
    onMfaRequired,
  });

  await client.activity("/public/v1/submit/test", {}, "testResult");
  expect(calls).toEqual(["mfa-status", "handler", "poll"]);
});

test("falls back to ordinary polling when consensus has no MFA challenges", async () => {
  const onMfaRequired = jest.fn(async () => undefined);
  const calls: string[] = [];
  global.fetch = jest
    .fn<() => Promise<Response>>()
    .mockImplementationOnce(() =>
      response({
        activity: {
          id: "activity-4",
          organizationId: "org-1",
          type: "ACTIVITY_TYPE_APPROVE_ACTIVITY",
          status: "ACTIVITY_STATUS_CONSENSUS_NEEDED",
        },
      }),
    )
    .mockImplementationOnce(() => {
      calls.push("mfa-status");
      return response({ mfaStatuses: [] });
    })
    .mockImplementationOnce(() => {
      calls.push("poll");
      return response({
        activity: {
          id: "activity-4",
          organizationId: "org-1",
          type: "ACTIVITY_TYPE_APPROVE_ACTIVITY",
          status: "ACTIVITY_STATUS_COMPLETED",
          result: {},
        },
      });
    }) as unknown as typeof fetch;
  const client = new ZeroXKeySDKClientBase({
    apiBaseUrl: "https://example.test",
    organizationId: "org-1",
    activityPoller: { intervalMs: 0, numRetries: 1 },
    onMfaRequired,
  });

  const result = await client.activity(
    "/public/v1/submit/test",
    {},
    "testResult",
  );

  expect(calls).toEqual(["mfa-status", "poll"]);
  expect(onMfaRequired).not.toHaveBeenCalled();
  expect((result as { activity: { status: string } }).activity.status).toBe(
    "ACTIVITY_STATUS_COMPLETED",
  );
});
