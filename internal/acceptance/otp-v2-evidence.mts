/** Bounded, read-only staging evidence. Raw log records never leave this module. */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, readdir, open } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const CONTEXT = "arn:aws:eks:ap-southeast-1:440744256864:cluster/0xkey-staging";
const NAMESPACE = "0xkey";
const LOG_LIMIT = 1024 * 1024;
const MAX_PODS = 8;
const MAX_WINDOW_MS = 180_000;
const COMMAND_TIMEOUT_MS = 10_000;
class EvidenceDeadlineExpired extends Error {}
const hex64 = /^[0-9a-f]{64}$/;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ExpiryEvidence = {
  requestId: string;
  activityId: string;
  activityFingerprint: string;
  decidedAtMs: number;
  reason: "VERIFICATION_TOKEN_EXPIRED";
  source: "activity";
};
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : NaN;

function jsonLine(line: string): RecordValue | undefined {
  try {
    const start = line.indexOf("{");
    if (start < 0) return undefined;
    const parsed: unknown = JSON.parse(line.slice(start));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return undefined;
    const value = parsed as RecordValue;
    if (!("fields" in value)) return value;
    const fields = value.fields;
    return fields !== null &&
      typeof fields === "object" &&
      !Array.isArray(fields)
      ? (fields as RecordValue)
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseExpiryEvents(input: {
  requestId: string;
  proxyLines: string[];
  coordinatorLines: string[];
  notBeforeMs: number;
}): ExpiryEvidence | undefined {
  if (!uuid.test(input.requestId) || !Number.isSafeInteger(input.notBeforeMs))
    return undefined;
  const proxyRecords = input.proxyLines.map(jsonLine);
  const coordinatorRecords = input.coordinatorLines.map(jsonLine);
  if (proxyRecords.some((x) => !x) || coordinatorRecords.some((x) => !x))
    return undefined;
  const proxies = proxyRecords.filter(
    (x): x is RecordValue =>
      x !== undefined &&
      x.event === "otp_v2_login_downstream_rejected" &&
      x.request_id === input.requestId,
  );
  if (proxies.length !== 1) return undefined;
  const proxy = proxies[0]!;
  const fingerprint = text(proxy.activity_fingerprint);
  const status = integer(proxy.http_status);
  const observedAtMs = integer(proxy.observed_at_ms);
  if (
    !hex64.test(fingerprint) ||
    !Number.isSafeInteger(status) ||
    status < 300 ||
    status > 599 ||
    !Number.isSafeInteger(observedAtMs) ||
    observedAtMs < input.notBeforeMs
  )
    return undefined;
  const decisions = coordinatorRecords.filter(
    (x): x is RecordValue =>
      x !== undefined &&
      x.event === "otp_v2_login_token_rejected" &&
      x.activity_fingerprint === fingerprint,
  );
  if (decisions.length !== 1) return undefined;
  const decision = decisions[0]!;
  const activityId = text(decision.activity_id);
  const decidedAtMs = integer(decision.decided_at_ms);
  if (
    !activityId ||
    activityId.length > 128 ||
    decision.reason !== "VERIFICATION_TOKEN_EXPIRED" ||
    !Number.isSafeInteger(decidedAtMs) ||
    decidedAtMs < input.notBeforeMs ||
    decidedAtMs > observedAtMs + 10_000
  )
    return undefined;
  return {
    requestId: input.requestId,
    activityId,
    activityFingerprint: fingerprint,
    decidedAtMs,
    reason: "VERIFICATION_TOKEN_EXPIRED",
    source: "activity",
  };
}

/** Digest path, NUL, byte length, and file hash for every built ordinary file. */
export async function sdkArtifactsDigest(root: string): Promise<string> {
  const base = resolve(root);
  const rootInfo = await lstat(base);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw Error("SDK_BUILD_UNSAFE_PATH");
  const files: string[] = [];
  async function visit(path: string) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
      throw Error("SDK_BUILD_UNSAFE_PATH");
    const rel = relative(base, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep))
      throw Error("SDK_BUILD_UNSAFE_PATH");
    if (info.isFile()) {
      files.push(rel.replaceAll(sep, "/"));
      return;
    }
    for (const name of await readdir(path)) await visit(join(path, name));
  }
  await visit(join(base, "pnpm-lock.yaml"));
  for (const category of ["packages", "internal"]) {
    const parent = join(base, category);
    const parentInfo = await lstat(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
      throw Error("SDK_BUILD_UNSAFE_PATH");
    for (const child of await readdir(parent)) {
      const childPath = join(parent, child);
      const childInfo = await lstat(childPath);
      if (childInfo.isSymbolicLink()) throw Error("SDK_BUILD_UNSAFE_PATH");
      if (!childInfo.isDirectory()) continue;
      const dist = join(childPath, "dist");
      try {
        await visit(dist);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  if (
    !files.includes("packages/core/dist/index.mjs") ||
    !files.includes("packages/crypto/dist/index.mjs") ||
    files.length < 3
  )
    throw Error("SDK_BUILD_MISSING");
  files.sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    const handle = await open(
      join(base, rel),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let bytes: Buffer;
    try {
      if (!(await handle.stat()).isFile()) throw Error("SDK_BUILD_UNSAFE_PATH");
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    hash
      .update(rel)
      .update("\0")
      .update(String(bytes.length))
      .update("\0")
      .update(createHash("sha256").update(bytes).digest("hex"))
      .update("\n");
  }
  return hash.digest("hex");
}

export type CommandRunner = (
  args: readonly string[],
  maxBytes: number,
  timeoutMs: number,
) => Promise<Buffer>;
export const kubectlRunner: CommandRunner = async (args, maxBytes, timeoutMs) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn("kubectl", [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const fail = () => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        reject(Error("EVIDENCE_READ_FAILED"));
      }
    };
    const timer = setTimeout(fail, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) fail();
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) fail();
    });
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) resolvePromise(Buffer.concat(output));
      else reject(Error("EVIDENCE_READ_FAILED"));
    });
  });

type Pod = {
  name: string;
  uid: string;
  imageId: string;
  restartCount: number;
  startedAtMs: number;
};
type Snapshot = { authProxy: Pod[]; coordinator: Pod[] };
function parseJson(bytes: Buffer): RecordValue {
  try {
    return object(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw Error("EVIDENCE_READ_FAILED");
  }
}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const candidateImage = (value: string) =>
  /^(?:(?:[a-z0-9][a-z0-9._:-]*:\/\/)?[^\s@]+@sha256:|containerd:\/\/sha256:)[0-9a-f]{64}$/.test(
    value,
  );
function endpoint(value: string) {
  if (
    !/^https:\/\/[^/?#@\\%\s]+\/?$/i.test(value) ||
    /[^\x21-\x7e]/.test(value)
  )
    throw Error("EVIDENCE_CANDIDATE_REQUIRED");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== `${url.origin}/`
  )
    throw Error("EVIDENCE_CANDIDATE_REQUIRED");
  return url.href;
}

export class BoundedEvidenceReader {
  private baseline?: Snapshot;
  private windowStartMs?: number;
  private requestStartMs?: number;
  constructor(
    private readonly pins: {
      clusterEndpoint: string;
      authProxyImageId: string;
      coordinatorImageId: string;
    },
    private readonly runner: CommandRunner = kubectlRunner,
  ) {
    endpoint(pins.clusterEndpoint);
    if (
      !candidateImage(pins.authProxyImageId) ||
      !candidateImage(pins.coordinatorImageId)
    )
      throw Error("EVIDENCE_CANDIDATE_REQUIRED");
  }
  private checkDeadline(deadline?: number): void {
    if (deadline !== undefined && performance.now() >= deadline)
      throw new EvidenceDeadlineExpired();
  }
  private async command(args: string[], limit = 256 * 1024, deadline?: number) {
    this.checkDeadline(deadline);
    const remaining =
      deadline === undefined
        ? COMMAND_TIMEOUT_MS
        : Math.min(
            COMMAND_TIMEOUT_MS,
            Math.floor(deadline - performance.now()),
          );
    if (remaining <= 0) throw new EvidenceDeadlineExpired();
    try {
      const output = await this.runner(args, limit, remaining);
      this.checkDeadline(deadline);
      return output;
    } catch (error) {
      this.checkDeadline(deadline);
      throw error;
    }
  }
  private scoped(args: string[]) {
    return ["--context", CONTEXT, "--namespace", NAMESPACE, ...args];
  }
  private async snapshot(deadline?: number): Promise<Snapshot> {
    const result = {} as Snapshot;
    for (const [name, expected] of [
      ["auth-proxy", this.pins.authProxyImageId],
      ["coordinator", this.pins.coordinatorImageId],
    ] as const) {
      const deployment = parseJson(
        await this.command(
          this.scoped(["get", "deployment", name, "-o", "json"]),
          256 * 1024,
          deadline,
        ),
      );
      const metadata = object(deployment.metadata);
      if (
        metadata.name !== name ||
        metadata.namespace !== NAMESPACE ||
        !text(metadata.uid)
      )
        throw Error("EVIDENCE_WORKLOAD_MISMATCH");
      const selector = object(
        object(object(deployment.spec).selector).matchLabels,
      );
      const entries = Object.entries(selector).sort();
      if (
        !entries.length ||
        entries.some(
          ([k, v]) =>
            !/^[a-zA-Z0-9._/-]+$/.test(k) || !/^[a-zA-Z0-9._-]+$/.test(text(v)),
        )
      )
        throw Error("EVIDENCE_WORKLOAD_MISMATCH");
      const label = entries.map(([k, v]) => `${k}=${v}`).join(",");
      const rsItems = list(
        parseJson(
          await this.command(
            this.scoped(["get", "replicasets", "-l", label, "-o", "json"]),
            256 * 1024,
            deadline,
          ),
        ).items,
      );
      const rsUids = new Set(
        rsItems
          .filter((x) =>
            list(object(object(x).metadata).ownerReferences).some(
              (y) =>
                object(y).uid === metadata.uid &&
                object(y).kind === "Deployment",
            ),
          )
          .map((x) => text(object(object(x).metadata).uid)),
      );
      const podItems = list(
        parseJson(
          await this.command(
            this.scoped(["get", "pods", "-l", label, "-o", "json"]),
            256 * 1024,
            deadline,
          ),
        ).items,
      );
      if (!podItems.length || podItems.length > MAX_PODS)
        throw Error("EVIDENCE_POD_BOUND");
      const pods: Pod[] = [];
      for (const item of podItems) {
        const pod = object(item),
          meta = object(pod.metadata);
        if (
          meta.namespace !== NAMESPACE ||
          !text(meta.uid) ||
          !/^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/.test(text(meta.name)) ||
          text(meta.name).length > 253 ||
          !list(meta.ownerReferences).some(
            (x) =>
              rsUids.has(text(object(x).uid)) &&
              object(x).kind === "ReplicaSet",
          )
        )
          throw Error("EVIDENCE_WORKLOAD_MISMATCH");
        const containers = list(object(pod.spec).containers);
        const statuses = list(object(pod.status).containerStatuses);
        const container = containers.find((x) => object(x).name === name);
        const status = statuses.find((x) => object(x).name === name);
        const startedAtMs = Date.parse(
          text(object(object(object(status).state).running).startedAt),
        );
        if (
          !container ||
          !status ||
          object(status).ready !== true ||
          object(status).imageID !== expected ||
          !Number.isSafeInteger(object(status).restartCount) ||
          !Number.isFinite(startedAtMs)
        )
          throw Error("EVIDENCE_IMAGE_MISMATCH");
        pods.push({
          name: text(meta.name),
          uid: text(meta.uid),
          imageId: expected,
          restartCount: integer(object(status).restartCount),
          startedAtMs,
        });
      }
      pods.sort((a, b) => a.name.localeCompare(b.name));
      result[name === "auth-proxy" ? "authProxy" : "coordinator"] = pods;
    }
    return result;
  }
  async preflight() {
    const actual = (
      await this.command(
        [
          "--context",
          CONTEXT,
          "config",
          "view",
          "--minify",
          "-o",
          "jsonpath={.clusters[0].cluster.server}",
        ],
        4096,
      )
    ).toString("utf8");
    let actualEndpoint: string;
    try {
      actualEndpoint = endpoint(actual);
    } catch {
      throw Error("EVIDENCE_CLUSTER_MISMATCH");
    }
    if (actualEndpoint !== endpoint(this.pins.clusterEndpoint))
      throw Error("EVIDENCE_CLUSTER_MISMATCH");
    this.baseline = await this.snapshot();
    // Prove read permission on both selected containers before the first OTP.
    const since = new Date(Date.now() - 1000).toISOString();
    for (const [name, pods] of [
      ["auth-proxy", this.baseline.authProxy],
      ["coordinator", this.baseline.coordinator],
    ] as const)
      for (const pod of pods) await this.logs(name, pod, since);
  }
  async beginWindow(nowMs: number) {
    if (!this.baseline || !Number.isSafeInteger(nowMs))
      throw Error("EVIDENCE_PREFLIGHT_REQUIRED");
    this.baseline = await this.snapshot();
    this.requestStartMs = nowMs;
    this.windowStartMs = nowMs - 30_000;
  }
  private async logs(
    name: string,
    pod: Pod,
    since: string,
    deadline?: number,
  ): Promise<string[]> {
    const bytes = await this.command(
      this.scoped([
        "logs",
        pod.name,
        "-c",
        name,
        `--since-time=${since}`,
        "--timestamps=true",
        `--limit-bytes=${LOG_LIMIT + 1}`,
      ]),
      LOG_LIMIT + 1,
      deadline,
    );
    if (bytes.length > LOG_LIMIT) throw Error("EVIDENCE_LOG_TRUNCATED");
    const raw = bytes.toString("utf8");
    if (raw && !raw.endsWith("\n")) throw Error("EVIDENCE_LOG_TRUNCATED");
    return raw.split("\n").filter(Boolean);
  }
  async resolve(
    requestId: string,
    notBeforeMs: number,
    nowMs: number,
  ): Promise<ExpiryEvidence | undefined> {
    if (
      !this.baseline ||
      this.windowStartMs === undefined ||
      this.requestStartMs === undefined ||
      !Number.isSafeInteger(nowMs) ||
      nowMs < this.windowStartMs ||
      nowMs - this.windowStartMs > MAX_WINDOW_MS ||
      notBeforeMs < this.windowStartMs ||
      !uuid.test(requestId)
    )
      return undefined;
    const deadline =
      performance.now() + MAX_WINDOW_MS - (nowMs - this.windowStartMs);
    try {
      this.checkDeadline(deadline);
      const after = await this.snapshot(deadline);
      for (const key of ["authProxy", "coordinator"] as const) {
        if (
          JSON.stringify(after[key]) !== JSON.stringify(this.baseline[key]) ||
          after[key].some((p) => p.startedAtMs > this.windowStartMs!)
        )
          return undefined;
      }
      const since = new Date(this.windowStartMs).toISOString();
      const proxyLines: string[] = [],
        coordinatorLines: string[] = [];
      const covered = (lines: string[]) => {
        const times = lines.map((line) => {
          const stamp = line.split(" ", 1)[0] ?? "";
          return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(stamp)
            ? Date.parse(stamp)
            : NaN;
        });
        return (
          times.length > 0 &&
          times.every(
            (time, i) =>
              Number.isFinite(time) &&
              time >= this.windowStartMs! &&
              (i === 0 || time >= times[i - 1]!),
          ) &&
          times[0]! <= this.requestStartMs!
        );
      };
      for (const pod of this.baseline.authProxy) {
        const lines = await this.logs("auth-proxy", pod, since, deadline);
        if (!covered(lines)) return undefined;
        proxyLines.push(...lines);
      }
      for (const pod of this.baseline.coordinator) {
        const lines = await this.logs("coordinator", pod, since, deadline);
        if (!covered(lines)) return undefined;
        coordinatorLines.push(...lines);
      }
      const last = await this.snapshot(deadline);
      if (JSON.stringify(last) !== JSON.stringify(this.baseline))
        return undefined;
      const evidence = parseExpiryEvents({
        requestId,
        proxyLines,
        coordinatorLines,
        notBeforeMs,
      });
      this.checkDeadline(deadline);
      return evidence;
    } catch (error) {
      if (error instanceof EvidenceDeadlineExpired) return undefined;
      throw error;
    }
  }
}
