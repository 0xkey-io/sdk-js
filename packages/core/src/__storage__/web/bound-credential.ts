import {
  pointEncode,
  uint8ArrayFromHexString,
  uint8ArrayToHexString,
} from "@0xkey-io/encoding";
import { uncompressRawPublicKey } from "@0xkey-io/crypto";
import { assertValidP256ECDSAKeyPair, parseSession } from "@utils";
import {
  boundTargetKey,
  emptyBoundRecord,
  readBoundRecord,
  type BoundAuthTarget,
} from "../bound-session";
import {
  WebAtomicBoundSessionStore,
  type BoundCredentialStores,
} from "./bound-session";
import { assertSignedBoundSessionJwt } from "./session-jwt-signature";

const EPOCH = "epoch";
const targetGenerationKey = (target: BoundAuthTarget): string =>
  boundTargetKey(target).replace(
    "@0xkey-io/auth/v3/target/",
    "@0xkey-io/auth/v3/target-generation/",
  );

function assertTargetGeneration(value: unknown, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 0)
    throw new Error("Invalid target generation");
  const current = value === undefined ? 0 : value;
  if (!Number.isSafeInteger(current) || current !== expected)
    throw new Error("Bound target generation changed");
}

interface PendingClaim {
  claimId: string;
  targetKey: string;
  targetGeneration: number;
}

interface SessionReference {
  targetKey: string;
  sessionKey: string;
  token: string;
  targetGeneration: number;
  operationNonce?: string;
}

interface KeyOwner {
  version: 1;
  publicKey: string;
  ownerId: string;
  pending: PendingClaim[];
  references: SessionReference[];
}

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

function assertEpoch(value: unknown, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 0)
    throw new Error("Invalid epoch");
  const current = value === undefined ? 0 : value;
  if (!Number.isSafeInteger(current) || current !== expected)
    throw new Error("Bound credential epoch changed");
}

function readOwner(value: unknown, publicKey: string): KeyOwner {
  if (!value || typeof value !== "object") throw new Error("Missing key owner");
  const owner = value as Partial<KeyOwner>;
  if (
    owner.version !== 1 ||
    owner.publicKey !== publicKey ||
    !nonempty(owner.ownerId) ||
    !Array.isArray(owner.pending) ||
    !Array.isArray(owner.references)
  )
    throw new Error("Invalid key owner");
  const claims = new Set<string>();
  for (const claim of owner.pending) {
    if (
      !nonempty(claim?.claimId) ||
      !nonempty(claim?.targetKey) ||
      (claim.targetGeneration !== undefined &&
        (!Number.isSafeInteger(claim.targetGeneration) ||
          claim.targetGeneration < 0)) ||
      claims.has(claim.claimId)
    )
      throw new Error("Invalid key owner");
    claims.add(claim.claimId);
  }
  const refs = new Set<string>();
  for (const ref of owner.references) {
    if (
      !nonempty(ref?.targetKey) ||
      !nonempty(ref?.sessionKey) ||
      !nonempty(ref?.token) ||
      (ref.operationNonce !== undefined && !nonempty(ref.operationNonce)) ||
      (ref.targetGeneration !== undefined &&
        (!Number.isSafeInteger(ref.targetGeneration) ||
          ref.targetGeneration < 0)) ||
      parseSession(ref.token).publicKey !== publicKey
    )
      throw new Error("Invalid key owner");
    const key = JSON.stringify([ref.targetKey, ref.sessionKey]);
    if (refs.has(key)) throw new Error("Invalid key owner");
    refs.add(key);
  }
  return owner as KeyOwner;
}

function abort(stores: BoundCredentialStores): void {
  try {
    stores.meta.transaction.abort();
  } catch {
    // The transaction may already have aborted on a failed request.
  }
}

function readTogether(
  stores: BoundCredentialStores,
  requests: IDBRequest[],
  apply: (values: unknown[]) => void,
): void {
  const values: unknown[] = [];
  let pending = requests.length;
  requests.forEach((request, index) => {
    request.onsuccess = () => {
      values[index] = request.result;
      if (--pending !== 0) return;
      try {
        apply(values);
      } catch {
        abort(stores);
      }
    };
  });
}

function isP256PrivateSigningKey(value: unknown): value is CryptoKey {
  if (typeof CryptoKey === "undefined" || !(value instanceof CryptoKey))
    return false;
  const algorithm = value.algorithm as EcKeyAlgorithm;
  return (
    value.type === "private" &&
    value.extractable === false &&
    value.usages.includes("sign") &&
    algorithm.name === "ECDSA" &&
    algorithm.namedCurve === "P-256"
  );
}

/**
 * Opt-in v3 credential primitive. Core and the legacy V2 stamper do not call it.
 * Every mutation covers session, key, owner, and epoch in one IDB transaction.
 */
export class WebBoundCredentialStore {
  private readonly store = new WebAtomicBoundSessionStore();

  /**
   * Internal cold-read evidence, not an authorization to send a request.
   * A readonly four-store snapshot is checked again after async key proof.
   * Older or unowned v3 records remain stored but are never returned.
   */
  async readVerifiedActive(
    target: BoundAuthTarget,
    expectedEpoch: number,
    expectedTargetGeneration: number,
  ): Promise<
    | {
        sessionKey: string;
        token: string;
        publicKey: string;
        targetGeneration: number;
      }
    | undefined
  > {
    const targetKey = boundTargetKey(target);
    let verified:
      | {
          sessionKey: string;
          token: string;
          publicKey: string;
          targetGeneration: number;
          operationNonce: string;
        }
      | undefined;
    let privateKeySnapshot: CryptoKey | undefined;
    await this.store.withCredentialRead((stores) => {
      readTogether(
        stores,
        [
          stores.meta.get(EPOCH),
          stores.meta.get(targetGenerationKey(target)),
          stores.sessions.get(targetKey),
        ],
        ([epoch, generation, value]) => {
          assertEpoch(epoch, expectedEpoch);
          assertTargetGeneration(generation, expectedTargetGeneration);
          const record = readBoundRecord(value, target);
          if (
            !record ||
            record.targetGeneration !== expectedTargetGeneration ||
            !record.activeSessionKey
          )
            return;
          const sessionKey = record.activeSessionKey;
          const token = record.sessions.find(
            (entry) => entry.key === sessionKey,
          )?.token;
          if (!token) return;
          const publicKey = parseSession(token).publicKey;
          if (!nonempty(publicKey)) return;
          readTogether(
            stores,
            [stores.owners.get(publicKey), stores.keys.get(publicKey)],
            ([ownerValue, privateKey]) => {
              if (!isP256PrivateSigningKey(privateKey)) return;
              const owner = readOwner(ownerValue, publicKey);
              const reference = owner.references.find(
                (ref) =>
                  ref.targetKey === targetKey &&
                  ref.sessionKey === sessionKey &&
                  ref.token === token &&
                  ref.targetGeneration === expectedTargetGeneration,
              );
              if (!reference?.operationNonce) return;
              verified = {
                sessionKey,
                token,
                publicKey,
                targetGeneration: expectedTargetGeneration,
                operationNonce: reference.operationNonce,
              };
              privateKeySnapshot = privateKey;
            },
          );
        },
      );
    });
    if (!verified || !privateKeySnapshot) return undefined;
    // Local owner/key evidence cannot establish that the Signer issued the
    // persisted token. A cold page must verify the same immutable anchor.
    let signedExpiry: number;
    try {
      const session = await assertSignedBoundSessionJwt(
        verified.token,
        target,
        verified.operationNonce,
      );
      if (session.publicKey !== verified.publicKey) return undefined;
      signedExpiry = session.expiry;
    } catch {
      return undefined;
    }
    // IDB gives one coherent snapshot. Prove the private CryptoKey stored under
    // the token's public-key slot is its actual signing key before returning it.
    try {
      const rawPublicKey = uncompressRawPublicKey(
        uint8ArrayFromHexString(verified.publicKey),
        "CURVE_P256",
      );
      const publicKey = await crypto.subtle.importKey(
        "raw",
        rawPublicKey,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      const challenge = new TextEncoder().encode("0xkey-v3-credential-read");
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKeySnapshot,
        challenge,
      );
      if (
        !(await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          publicKey,
          signature,
          challenge,
        ))
      )
        return undefined;
    } catch {
      return undefined;
    }
    // WebCrypto verification happens after the first IDB snapshot commits.
    // Fence retirement and token/owner replacement that completed during it.
    // This remains a verified snapshot, not a standing authorization to send.
    let stillCurrent = false;
    await this.store.withCredentialRead((stores) => {
      readTogether(
        stores,
        [
          stores.meta.get(EPOCH),
          stores.meta.get(targetGenerationKey(target)),
          stores.sessions.get(targetKey),
          stores.owners.get(verified!.publicKey),
          stores.keys.get(verified!.publicKey),
        ],
        ([epoch, generation, value, ownerValue, key]) => {
          assertEpoch(epoch, expectedEpoch);
          assertTargetGeneration(generation, expectedTargetGeneration);
          const record = readBoundRecord(value, target);
          if (
            record?.targetGeneration !== expectedTargetGeneration ||
            record.activeSessionKey !== verified!.sessionKey ||
            record.sessions.find((entry) => entry.key === verified!.sessionKey)
              ?.token !== verified!.token ||
            !isP256PrivateSigningKey(key)
          )
            return;
          const owner = readOwner(ownerValue, verified!.publicKey);
          stillCurrent = owner.references.some(
            (ref) =>
              ref.targetKey === targetKey &&
              ref.sessionKey === verified!.sessionKey &&
              ref.token === verified!.token &&
              ref.targetGeneration === expectedTargetGeneration &&
              ref.operationNonce === verified!.operationNonce,
          );
        },
      );
    });
    // The token was signed above and the second snapshot fenced replacement.
    // Keep the last check synchronous so no new await opens a storage race.
    return stillCurrent && signedExpiry > Date.now() / 1000
      ? {
          sessionKey: verified.sessionKey,
          token: verified.token,
          publicKey: verified.publicKey,
          targetGeneration: verified.targetGeneration,
        }
      : undefined;
  }

  async readEpoch(): Promise<number> {
    let epoch = 0;
    await this.store.withCredentialTransaction((stores) => {
      readTogether(stores, [stores.meta.get(EPOCH)], ([value]) => {
        if (
          value !== undefined &&
          (!Number.isSafeInteger(value) || (value as number) < 0)
        )
          throw new Error("Invalid epoch");
        epoch = (value as number | undefined) ?? 0;
      });
    }, new AbortController().signal);
    return epoch;
  }

  async createPendingKey(
    pair: CryptoKeyPair,
    target: BoundAuthTarget,
    ownerId: string,
    claimId: string,
    expectedEpoch: number,
    signal: AbortSignal,
    expectedTargetGeneration = 0,
  ): Promise<string> {
    if (!nonempty(ownerId) || !nonempty(claimId))
      throw new Error("Invalid claim");
    const targetKey = boundTargetKey(target);
    await assertValidP256ECDSAKeyPair(pair);
    const rawPublicKey = new Uint8Array(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    );
    const publicKey = uint8ArrayToHexString(pointEncode(rawPublicKey));
    await this.store.withCredentialTransaction((stores) => {
      readTogether(
        stores,
        [
          stores.meta.get(EPOCH),
          stores.meta.get(targetGenerationKey(target)),
          stores.keys.get(publicKey),
          stores.owners.get(publicKey),
        ],
        ([epoch, generation, key, owner]) => {
          assertEpoch(epoch, expectedEpoch);
          assertTargetGeneration(generation, expectedTargetGeneration);
          if (key !== undefined || owner !== undefined)
            throw new Error("Key already exists");
          stores.keys.add(pair.privateKey, publicKey);
          stores.owners.add(
            {
              version: 1,
              publicKey,
              ownerId,
              pending: [
                {
                  claimId,
                  targetKey,
                  targetGeneration: expectedTargetGeneration,
                },
              ],
              references: [],
            } satisfies KeyOwner,
            publicKey,
          );
        },
      );
    }, signal);
    return publicKey;
  }

  async reservePendingClaim(
    publicKey: string,
    ownerId: string,
    target: BoundAuthTarget,
    claimId: string,
    expectedEpoch: number,
    signal: AbortSignal,
    expectedTargetGeneration = 0,
  ): Promise<void> {
    if (!nonempty(claimId)) throw new Error("Invalid claim");
    const targetKey = boundTargetKey(target);
    await this.store.withCredentialTransaction((stores) => {
      readTogether(
        stores,
        [
          stores.meta.get(EPOCH),
          stores.meta.get(targetGenerationKey(target)),
          stores.keys.get(publicKey),
          stores.owners.get(publicKey),
        ],
        ([epoch, generation, key, value]) => {
          assertEpoch(epoch, expectedEpoch);
          assertTargetGeneration(generation, expectedTargetGeneration);
          if (key === undefined) throw new Error("Missing key");
          const owner = readOwner(value, publicKey);
          if (
            owner.ownerId !== ownerId ||
            owner.pending.some((item) => item.claimId === claimId)
          )
            throw new Error("Claim not owned");
          stores.owners.put(
            {
              ...owner,
              pending: [
                ...owner.pending,
                {
                  claimId,
                  targetKey,
                  targetGeneration: expectedTargetGeneration,
                },
              ],
            },
            publicKey,
          );
        },
      );
    }, signal);
  }

  async claimSession(
    target: BoundAuthTarget,
    sessionKey: string,
    token: string,
    claimId: string,
    expectedEpoch: number,
    expectedCurrentToken: string | undefined,
    signal: AbortSignal,
    expectedTargetGeneration = 0,
  ): Promise<void> {
    if (!nonempty(sessionKey) || !nonempty(claimId))
      throw new Error("Invalid claim");
    // This primitive is also called directly by internal storage users.
    // Verify issuance before consuming the pending claim, even when its
    // caller already checked the token at the Core boundary.
    const verifiedSession = await assertSignedBoundSessionJwt(
      token,
      target,
      claimId,
    );
    const publicKey = verifiedSession.publicKey;
    if (!nonempty(publicKey)) throw new Error("Session has no public key");
    const targetKey = boundTargetKey(target);
    await this.store.withCredentialTransaction((stores) => {
      readTogether(
        stores,
        [
          stores.meta.get(EPOCH),
          stores.meta.get(targetGenerationKey(target)),
          stores.sessions.get(targetKey),
          stores.keys.get(publicKey),
          stores.owners.get(publicKey),
        ],
        ([epoch, generation, value, key, ownerValue]) => {
          if (verifiedSession.expiry <= Date.now() / 1000)
            throw new Error("Session JWT expired before claim mutation");
          assertEpoch(epoch, expectedEpoch);
          assertTargetGeneration(generation, expectedTargetGeneration);
          if (key === undefined) throw new Error("Missing key");
          const owner = readOwner(ownerValue, publicKey);
          if (
            !owner.pending.some(
              (claim) =>
                claim.claimId === claimId &&
                claim.targetKey === targetKey &&
                claim.targetGeneration === expectedTargetGeneration,
            )
          )
            throw new Error("Missing pending claim");
          const record =
            readBoundRecord(value, target) ?? emptyBoundRecord(target);
          if (
            record.sessions.length > 0 &&
            record.targetGeneration !== expectedTargetGeneration
          )
            throw new Error("Prior session target generation is unknown");
          const prior = record.sessions.find(
            (entry) => entry.key === sessionKey,
          )?.token;
          if (prior !== expectedCurrentToken)
            throw new Error("Session changed");
          if (prior && parseSession(prior).publicKey !== publicKey)
            throw new Error("Changing session key ownership is unsupported");
          if (
            prior &&
            !owner.references.some(
              (ref) =>
                ref.targetKey === targetKey &&
                ref.sessionKey === sessionKey &&
                ref.token === prior &&
                ref.targetGeneration === expectedTargetGeneration,
            )
          )
            throw new Error("Prior session lacks owner reference");
          stores.sessions.put(
            {
              ...record,
              targetGeneration: expectedTargetGeneration,
              sessions: [
                ...record.sessions.filter((entry) => entry.key !== sessionKey),
                { key: sessionKey, token },
              ],
              activeSessionKey: sessionKey,
            },
            targetKey,
          );
          stores.owners.put(
            {
              ...owner,
              pending: owner.pending.filter(
                (claim) => claim.claimId !== claimId,
              ),
              references: [
                ...owner.references.filter(
                  (ref) =>
                    ref.targetKey !== targetKey ||
                    ref.sessionKey !== sessionKey,
                ),
                {
                  targetKey,
                  sessionKey,
                  token,
                  targetGeneration: expectedTargetGeneration,
                  operationNonce: claimId,
                },
              ],
            },
            publicKey,
          );
        },
      );
    }, signal);
  }

  async clearSession(
    target: BoundAuthTarget,
    sessionKey: string,
    expectedToken: string,
    expectedEpoch: number,
    signal: AbortSignal,
    expectedTargetGeneration = 0,
  ): Promise<boolean> {
    const publicKey = parseSession(expectedToken).publicKey;
    if (!nonempty(publicKey)) throw new Error("Session has no public key");
    const targetKey = boundTargetKey(target);
    let cleared = false;
    await this.store.withCredentialTransaction((stores) => {
      readTogether(
        stores,
        [
          stores.meta.get(EPOCH),
          stores.meta.get(targetGenerationKey(target)),
          stores.sessions.get(targetKey),
          stores.keys.get(publicKey),
          stores.owners.get(publicKey),
          stores.sessions.getAllKeys(),
          stores.sessions.getAll(),
        ],
        ([epoch, generation, value, key, ownerValue, allKeys, allValues]) => {
          assertEpoch(epoch, expectedEpoch);
          assertTargetGeneration(generation, expectedTargetGeneration);
          const record = readBoundRecord(value, target);
          if (record && record.targetGeneration !== expectedTargetGeneration)
            throw new Error("Prior session target generation is unknown");
          if (
            record?.sessions.find((entry) => entry.key === sessionKey)
              ?.token !== expectedToken
          )
            return;
          if (key === undefined) throw new Error("Missing key");
          const owner = readOwner(ownerValue, publicKey);
          if (
            !owner.references.some(
              (ref) =>
                ref.targetKey === targetKey &&
                ref.sessionKey === sessionKey &&
                ref.token === expectedToken &&
                ref.targetGeneration === expectedTargetGeneration,
            )
          )
            throw new Error("Missing session owner reference");
          const sessions = record.sessions.filter(
            (entry) => entry.key !== sessionKey,
          );
          if (sessions.length)
            stores.sessions.put(
              {
                ...record,
                sessions,
                activeSessionKey:
                  record.activeSessionKey === sessionKey
                    ? undefined
                    : record.activeSessionKey,
              },
              targetKey,
            );
          else stores.sessions.delete(targetKey);
          const references = owner.references.filter(
            (ref) =>
              ref.targetKey !== targetKey || ref.sessionKey !== sessionKey,
          );
          // The new owner index can coexist with pre-index v3 records. Scan the
          // session store inside this transaction before removing the last key.
          // Any malformed record aborts instead of claiming sole ownership.
          const records = allValues as unknown[];
          const recordKeys = allKeys as IDBValidKey[];
          if (!Array.isArray(records) || records.length !== recordKeys.length)
            throw new Error("Invalid bound session inventory");
          const hasUnindexedReference = records.some((entry, index) => {
            if (!entry || typeof entry !== "object" || !("target" in entry))
              throw new Error("Invalid bound session inventory");
            const otherTarget = (entry as { target: BoundAuthTarget }).target;
            if (boundTargetKey(otherTarget) !== recordKeys[index])
              throw new Error("Invalid bound session inventory");
            const other = readBoundRecord(entry, otherTarget);
            if (!other) throw new Error("Invalid bound session inventory");
            return other.sessions.some(
              (session) =>
                !(
                  recordKeys[index] === targetKey &&
                  session.key === sessionKey &&
                  session.token === expectedToken
                ) && parseSession(session.token).publicKey === publicKey,
            );
          });
          if (
            references.length ||
            owner.pending.length ||
            hasUnindexedReference
          )
            stores.owners.put({ ...owner, references }, publicKey);
          else {
            stores.owners.delete(publicKey);
            stores.keys.delete(publicKey);
          }
          cleared = true;
        },
      );
    }, signal);
    return cleared;
  }

  async clearAll(expectedEpoch: number, signal: AbortSignal): Promise<number> {
    let nextEpoch = 0;
    await this.store.withCredentialTransaction((stores) => {
      readTogether(stores, [stores.meta.get(EPOCH)], ([value]) => {
        assertEpoch(value, expectedEpoch);
        if (expectedEpoch === Number.MAX_SAFE_INTEGER)
          throw new Error("Epoch exhausted");
        nextEpoch = expectedEpoch + 1;
        stores.meta.put(nextEpoch, EPOCH);
        stores.sessions.clear();
        stores.owners.clear();
        stores.keys.clear();
      });
    }, signal);
    return nextEpoch;
  }
}
