import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BoundedEvidenceReader,
  parseExpiryEvents,
  sdkArtifactsDigest,
  type ExpiryEvidence,
  type CommandRunner,
} from "./otp-v2-evidence.mts";

const fingerprint = "a".repeat(64);
const requestId = "11111111-1111-4111-8111-111111111111";
const proxy = JSON.stringify({
  event: "otp_v2_login_downstream_rejected",
  request_id: requestId,
  activity_fingerprint: fingerprint,
  http_status: 401,
  observed_at_ms: 1032000,
});
const coordinator = JSON.stringify({
  fields: {
    event: "otp_v2_login_token_rejected",
    reason: "VERIFICATION_TOKEN_EXPIRED",
    activity_id: "activity-B",
    activity_fingerprint: fingerprint,
    decided_at_ms: 1032000,
  },
});
const input = (p = proxy, c = coordinator) => ({
  requestId,
  proxyLines: [p],
  coordinatorLines: [c],
  notBeforeMs: 1032000,
});

test("one exact Go and Rust event pair yields allowlisted evidence", () => {
  assert.deepEqual(parseExpiryEvents(input()), {
    requestId,
    activityId: "activity-B",
    activityFingerprint: fingerprint,
    decidedAtMs: 1032000,
    reason: "VERIFICATION_TOKEN_EXPIRED",
    source: "activity",
  } satisfies ExpiryEvidence);
});

test("missing, duplicate, and cross-fingerprint evidence is inconclusive", () => {
  assert.equal(parseExpiryEvents({ ...input(), proxyLines: [] }), undefined);
  assert.equal(
    parseExpiryEvents({
      ...input(),
      coordinatorLines: [coordinator, coordinator],
    }),
    undefined,
  );
  assert.equal(
    parseExpiryEvents(
      input(proxy, coordinator.replace(fingerprint, "b".repeat(64))),
    ),
    undefined,
  );
});

test("malformed duplicate records cannot disappear from a unique event pair", () => {
  assert.equal(
    parseExpiryEvents({
      ...input(),
      proxyLines: [
        proxy,
        `{"event":"otp_v2_login_downstream_rejected","request_id":"${requestId}"`,
      ],
    }),
    undefined,
  );
  assert.equal(
    parseExpiryEvents({
      ...input(),
      coordinatorLines: [
        coordinator,
        `{"fields":{"event":"otp_v2_login_token_rejected","activity_fingerprint":"${fingerprint}"`,
      ],
    }),
    undefined,
  );
});

test("wrong reason, event type, version, and early decision are rejected", () => {
  assert.equal(
    parseExpiryEvents(
      input(
        proxy,
        coordinator.replace("VERIFICATION_TOKEN_EXPIRED", "TOKEN_CONSUMED"),
      ),
    ),
    undefined,
  );
  assert.equal(
    parseExpiryEvents(
      input(
        proxy.replace("otp_v2_login_downstream_rejected", "other"),
        coordinator,
      ),
    ),
    undefined,
  );
  assert.equal(
    parseExpiryEvents(
      input(
        proxy,
        coordinator.replace(
          "otp_v2_login_token_rejected",
          "otp_v1_login_token_rejected",
        ),
      ),
    ),
    undefined,
  );
  assert.equal(
    parseExpiryEvents({ ...input(), notBeforeMs: 1032001 }),
    undefined,
  );
  assert.equal(
    parseExpiryEvents(
      input(proxy.replace('"http_status":401,', ""), coordinator),
    ),
    undefined,
  );
  assert.equal(
    parseExpiryEvents(
      input(
        proxy,
        coordinator.replace(
          '"decided_at_ms":1032000',
          '"decided_at_ms":"1032000"',
        ),
      ),
    ),
    undefined,
  );
});

test("build tree digest changes for every built package file and lockfile, rejects symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "otp-build-tree-"));
  await mkdir(join(root, "packages/core/dist"), { recursive: true });
  await mkdir(join(root, "packages/crypto/dist"), { recursive: true });
  await mkdir(join(root, "internal/codec/dist"), { recursive: true });
  await writeFile(join(root, "pnpm-lock.yaml"), "lock-A");
  await writeFile(join(root, "packages/core/dist/index.mjs"), "core");
  await writeFile(join(root, "packages/crypto/dist/index.mjs"), "crypto");
  await writeFile(join(root, "internal/codec/dist/extra.js"), "extra-A");
  const first = await sdkArtifactsDigest(root);
  assert.match(first, /^[0-9a-f]{64}$/);
  await writeFile(join(root, "internal/codec/dist/extra.js"), "extra-B");
  assert.notEqual(await sdkArtifactsDigest(root), first);
  await writeFile(join(root, "pnpm-lock.yaml"), "lock-B");
  assert.notEqual(await sdkArtifactsDigest(root), first);
  await symlink(
    join(root, "pnpm-lock.yaml"),
    join(root, "packages/core/dist/link"),
  );
  await assert.rejects(sdkArtifactsDigest(root), /SDK_BUILD_UNSAFE_PATH/);
  await unlink(join(root, "packages/core/dist/link"));
  const linkedRoot = await mkdtemp(join(tmpdir(), "otp-linked-tree-"));
  await writeFile(join(linkedRoot, "pnpm-lock.yaml"), "lock");
  await symlink(join(root, "packages"), join(linkedRoot, "packages"));
  await mkdir(join(linkedRoot, "internal"));
  await assert.rejects(sdkArtifactsDigest(linkedRoot), /SDK_BUILD_UNSAFE_PATH/);
});

function fakeCluster(
  overrides: {
    oversized?: boolean;
    restarted?: boolean;
    wrongImage?: boolean;
    endpoint?: string;
    restartDuringWindow?: boolean;
    tooManyPods?: boolean;
    missingCoverage?: boolean;
    fractionalBoundary?: boolean;
    delayAtDeploymentRead?: number;
    pinnedEndpoint?: string;
  } = {},
) {
  const image = (name: string) =>
    `docker-pullable://${name}@sha256:${name === "auth-proxy" ? "a" : "b"}`.replace(
      /[ab]$/,
      (c) => c.repeat(64),
    );
  const calls: string[][] = [];
  let authPodReads = 0;
  let deploymentReads = 0;
  const timeouts: number[] = [];
  const runner: CommandRunner = async (args, maxBytes, timeoutMs) => {
    calls.push([...args]);
    timeouts.push(timeoutMs);
    assert.ok(timeoutMs > 0 && timeoutMs <= 10_000);
    const joined = args.join(" ");
    if (joined.includes("config view"))
      return Buffer.from(overrides.endpoint ?? "https://cluster.test");
    const name = joined.includes("coordinator") ? "coordinator" : "auth-proxy";
    if (joined.includes("get deployment")) {
      deploymentReads++;
      if (deploymentReads === overrides.delayAtDeploymentRead)
        await new Promise((done) => setTimeout(done, 250));
      return Buffer.from(
        JSON.stringify({
          metadata: { name, namespace: "0xkey", uid: `deploy-${name}` },
          spec: { selector: { matchLabels: { app: name } } },
        }),
      );
    }
    if (joined.includes("get replicasets"))
      return Buffer.from(
        JSON.stringify({
          items: [
            {
              metadata: {
                uid: `rs-${name}`,
                ownerReferences: [
                  { uid: `deploy-${name}`, kind: "Deployment" },
                ],
              },
            },
          ],
        }),
      );
    if (joined.includes("get pods")) {
      if (name === "auth-proxy") authPodReads++;
      const pod = {
        metadata: {
          name: `${name}-pod`,
          namespace: "0xkey",
          uid: `pod-${name}`,
          ownerReferences: [{ uid: `rs-${name}`, kind: "ReplicaSet" }],
        },
        spec: { containers: [{ name }] },
        status: {
          containerStatuses: [
            {
              name,
              ready: true,
              imageID: overrides.wrongImage ? "wrong" : image(name),
              restartCount:
                overrides.restartDuringWindow && authPodReads > 2 ? 1 : 0,
              state: { running: { startedAt: "1970-01-01T00:00:00Z" } },
            },
          ],
        },
      };
      return Buffer.from(
        JSON.stringify({
          items: overrides.tooManyPods
            ? Array.from({ length: 9 }, (_, i) => ({
                ...pod,
                metadata: { ...pod.metadata, name: `${name}-pod-${i}` },
              }))
            : [pod],
        }),
      );
    }
    if (joined.includes("logs")) {
      assert.ok(joined.includes("--limit-bytes=1048577"));
      assert.ok(maxBytes <= 1048577);
      if (overrides.oversized) return Buffer.alloc(1048577, 65);
      const marker = overrides.missingCoverage
        ? "1970-01-01T00:17:13.000Z"
        : "1970-01-01T00:17:11.000Z";
      return Buffer.from(
        `${overrides.fractionalBoundary ? '1970-01-01T00:16:42.169Z {"event":"other"}\n' : ""}${marker} {"event":"other"}\n1970-01-01T00:17:12.000Z ${name === "auth-proxy" ? proxy : coordinator}\n`,
      );
    }
    throw Error("unexpected command");
  };
  const reader = new BoundedEvidenceReader(
    {
      clusterEndpoint: overrides.pinnedEndpoint ?? "https://cluster.test",
      authProxyImageId: image("auth-proxy"),
      coordinatorImageId: image("coordinator"),
    },
    runner,
  );
  return { reader, calls, timeouts };
}

test("collector aligns fractional log windows to whole seconds", async () => {
  const { reader, calls } = fakeCluster({ fractionalBoundary: true });
  await reader.preflight();
  await reader.beginWindow(1032769);
  assert.equal(
    (await reader.resolve(requestId, 1032000, 1033000))?.reason,
    "VERIFICATION_TOKEN_EXPIRED",
  );
  assert.ok(
    calls.some((args) =>
      args.includes("--since-time=1970-01-01T00:16:42.000Z"),
    ),
  );
});

test("collector checks fixed context, workload/image pins and resolves a bounded pair", async () => {
  const { reader, calls } = fakeCluster();
  await reader.preflight();
  await reader.beginWindow(1032000);
  assert.deepEqual(await reader.resolve(requestId, 1032000, 1033000), {
    requestId,
    activityId: "activity-B",
    activityFingerprint: fingerprint,
    decidedAtMs: 1032000,
    reason: "VERIFICATION_TOKEN_EXPIRED",
    source: "activity",
  });
  assert.ok(
    calls.every(
      (args) =>
        args.includes("--context") &&
        args.includes(
          "arn:aws:eks:ap-southeast-1:440744256864:cluster/0xkey-staging",
        ),
    ),
  );
  assert.ok(
    calls
      .filter((args) => args.includes("logs"))
      .every((args) => args.includes("--namespace") && args.includes("0xkey")),
  );
  assert.equal(
    await reader.resolve(requestId, 1032000, 1032000 + 180001),
    undefined,
  );
});

test("preflight accepts the pinned cluster when kubectl reports an uppercase DNS host", async () => {
  const { reader } = fakeCluster({ endpoint: "https://CLUSTER.TEST" });
  await reader.preflight();
});

test("preflight applies the same HTTPS origin canonicalization to both endpoints", async () => {
  for (const options of [
    {
      pinnedEndpoint: "https://CLUSTER.TEST",
      endpoint: "https://cluster.test/",
    },
    {
      pinnedEndpoint: "https://cluster.test",
      endpoint: "https://CLUSTER.TEST:443/",
    },
  ]) {
    const { reader } = fakeCluster(options);
    await reader.preflight();
  }
});

test("preflight fails closed on any different or malformed actual cluster URL", async () => {
  for (const endpoint of [
    "https://other.test",
    "https://cluster.test.evil",
    "https://cluster.test:8443",
    "https://user@cluster.test",
    "https://user:pass@cluster.test",
    "https://cluster.test/path",
    "https://cluster.test/?query=1",
    "https://cluster.test/#fragment",
    "http://cluster.test",
    "not-a-url",
  ]) {
    const { reader } = fakeCluster({ endpoint });
    await assert.rejects(
      reader.preflight(),
      /EVIDENCE_CLUSTER_MISMATCH/,
      endpoint,
    );
  }
});

test("preflight rejects a dot-path erased by URL parsing", async () => {
  const { reader } = fakeCluster({ endpoint: "https://cluster.test/a/.." });
  await assert.rejects(reader.preflight(), /EVIDENCE_CLUSTER_MISMATCH/);
});

test("preflight rejects an empty userinfo marker erased by URL parsing", async () => {
  const { reader } = fakeCluster({ endpoint: "https://@cluster.test" });
  await assert.rejects(reader.preflight(), /EVIDENCE_CLUSTER_MISMATCH/);
});

test("preflight rejects raw backslash, whitespace, and encoded-host normalization", async () => {
  for (const endpoint of [
    "https://cluster.test\\a\\..",
    " https://cluster.test",
    "https://cluster.test ",
    "https://%63luster.test",
  ]) {
    const { reader } = fakeCluster({ endpoint });
    await assert.rejects(
      reader.preflight(),
      /EVIDENCE_CLUSTER_MISMATCH/,
      endpoint,
    );
  }
});

test("collector fails closed on wrong endpoint, image and truncated logs before OTP", async () => {
  for (const [option, code] of [
    [{ endpoint: "https://other.test" }, "EVIDENCE_CLUSTER_MISMATCH"],
    [{ wrongImage: true }, "EVIDENCE_IMAGE_MISMATCH"],
    [{ oversized: true }, "EVIDENCE_LOG_TRUNCATED"],
    [{ tooManyPods: true }, "EVIDENCE_POD_BOUND"],
  ] as const) {
    const { reader } = fakeCluster(option);
    await assert.rejects(reader.preflight(), new RegExp(code));
  }
});

test("a Pod restart inside the B evidence window is inconclusive", async () => {
  const { reader } = fakeCluster({ restartDuringWindow: true });
  await reader.preflight();
  await reader.beginWindow(1032000);
  assert.equal(await reader.resolve(requestId, 1032000, 1033000), undefined);
});

test("log stream without a pre-request record cannot prove coverage", async () => {
  const { reader } = fakeCluster({ missingCoverage: true });
  await reader.preflight();
  await reader.beginWindow(1032000);
  assert.equal(await reader.resolve(requestId, 1032000, 1033000), undefined);
});

test("collection cannot return evidence after the 180-second deadline", async () => {
  for (const read of [5, 8]) {
    const { reader, timeouts } = fakeCluster({ delayAtDeploymentRead: read });
    await reader.preflight();
    await reader.beginWindow(1032000);
    const before = timeouts.length;
    assert.equal(await reader.resolve(requestId, 1032000, 1181900), undefined);
    assert.ok(timeouts.slice(before).every((timeout) => timeout <= 100));
  }
});
