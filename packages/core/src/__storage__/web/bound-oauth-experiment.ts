import {
  hexStringToBase64url,
  stringToBase64urlString,
  uint8ArrayFromHexString,
  uint8ArrayToHexString,
} from "@0xkey-io/encoding";
import { uncompressRawPublicKey } from "@0xkey-io/crypto";
import { SignatureFormat } from "@0xkey-io/api-key-stamper";
import type { Session } from "@0xkey-io/sdk-types";
import { parseSession } from "@utils";
import {
  SessionKey,
  type ApiKeyStamperBase,
  type DeleteKeyPairOptions,
  type StorageBase,
  type TStamp,
} from "../../__types__";
import { convertEcdsaIeee1363ToDer } from "../../__stampers__/api/web/stamper";
import { boundTargetKey, type BoundAuthTarget } from "../bound-session";
import { WebBoundCredentialStore } from "./bound-credential";
import { WebAtomicBoundSessionStore } from "./bound-session";
import { assertSignedBoundSessionJwt } from "./session-jwt-signature";

/**
 * Internal OAuth proof path. It deliberately supports one active API-key
 * session and refuses unsupported mutations; it is not a production adapter.
 * Core's default Web manager and V2 stamper never instantiate this class.
 */
export class WebBoundOAuthExperiment implements StorageBase, ApiKeyStamperBase {
  private readonly credentials = new WebBoundCredentialStore();
  private readonly database = new WebAtomicBoundSessionStore();
  private readonly abort = new AbortController();
  private readonly ownerId = crypto.randomUUID();
  private readonly pendingClaims = new Map<string, string>();
  private epoch?: number;
  private active: { key: string; token: string } | undefined;
  private revoked = false;
  private guard?: () => boolean;

  constructor(
    private readonly target: BoundAuthTarget,
    private readonly targetGuard: () => boolean,
  ) {
    boundTargetKey(target);
  }

  private assertTarget(): void {
    if (!this.targetGuard()) throw new Error("Bound OAuth target changed");
  }

  private assertActive(): void {
    this.assertTarget();
    if (this.revoked || this.guard?.() === false || this.abort.signal.aborted)
      throw new Error("Bound OAuth context retired");
    if (this.epoch === undefined)
      throw new Error("Bound OAuth not initialized");
  }

  restrictToNewSessions(): void {
    this.active = undefined;
  }

  async bindTarget(target: BoundAuthTarget): Promise<boolean> {
    if (boundTargetKey(target) !== boundTargetKey(this.target))
      throw new Error("Bound OAuth target changed");
    this.assertTarget();
    this.epoch = await this.credentials.readEpoch();
    this.assertTarget();
    const verified = await this.credentials.readVerifiedActive(
      this.target,
      this.epoch,
      0,
    );
    this.assertTarget();
    this.active = verified
      ? { key: verified.sessionKey, token: verified.token }
      : undefined;
    this.assertActive();
    return true;
  }

  revokeAuthAccess(): void {
    this.revoked = true;
    this.active = undefined;
    this.pendingClaims.clear();
    this.abort.abort();
  }

  setAuthContextGuard(guard: () => boolean): void {
    this.guard = guard;
  }

  retainsKeyPairOnClear(): boolean {
    return true;
  }

  private async verifiedActive(): Promise<
    { key: string; token: string; publicKey: string } | undefined
  > {
    this.assertActive();
    const verified = await this.credentials.readVerifiedActive(
      this.target,
      this.epoch!,
      0,
    );
    this.assertActive();
    if (
      !verified ||
      verified.sessionKey !== this.active?.key ||
      verified.token !== this.active.token
    )
      return undefined;
    return {
      key: verified.sessionKey,
      token: verified.token,
      publicKey: verified.publicKey,
    };
  }

  async createKeyPair(
    externalKeyPair?: CryptoKeyPair | { publicKey: string; privateKey: string },
  ): Promise<string> {
    this.assertActive();
    if (externalKeyPair) throw new Error("External key import is unsupported");
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    );
    const claimId = hexStringToBase64url(
      uint8ArrayToHexString(crypto.getRandomValues(new Uint8Array(32))),
    );
    const publicKey = await this.credentials.createPendingKey(
      pair,
      this.target,
      this.ownerId,
      claimId,
      this.epoch!,
      this.abort.signal,
      0,
    );
    this.assertActive();
    this.pendingClaims.set(publicKey, claimId);
    return publicKey;
  }

  async storeSession(
    token: string,
    key: string = SessionKey.DefaultSessionkey,
  ): Promise<void> {
    this.assertActive();
    const publicKey = parseSession(token).publicKey;
    this.assertActive();
    const claimId = publicKey && this.pendingClaims.get(publicKey);
    if (!claimId) throw new Error("Session key has no pending v3 claim");
    await assertSignedBoundSessionJwt(token, this.target, claimId);
    this.assertActive();
    const prior = this.active?.key === key ? this.active.token : undefined;
    await this.credentials.claimSession(
      this.target,
      key,
      token,
      claimId,
      this.epoch!,
      prior,
      this.abort.signal,
      0,
    );
    this.assertActive();
    this.pendingClaims.delete(publicKey);
    this.active = { key, token };
  }

  async getSession(
    key: string = SessionKey.DefaultSessionkey,
  ): Promise<Session | undefined> {
    const active = await this.verifiedActive();
    return active?.key === key ? parseSession(active.token) : undefined;
  }

  getStorageValue(key: string): Promise<Session | undefined> {
    return this.getSession(key);
  }

  async getActiveSession(): Promise<Session | undefined> {
    const active = await this.verifiedActive();
    return active ? parseSession(active.token) : undefined;
  }

  async getActiveSessionKey(): Promise<string | undefined> {
    return (await this.verifiedActive())?.key;
  }

  async listSessionKeys(): Promise<string[]> {
    const active = await this.verifiedActive();
    return active ? [active.key] : [];
  }

  async setStorageValue(key: string, value: Session): Promise<void> {
    if (!value?.token) throw new Error("Session token is required");
    await this.storeSession(value.token, key);
  }

  async setActiveSessionKey(key: string): Promise<void> {
    if ((await this.verifiedActive())?.key !== key)
      throw new Error("Session is not bound to this client");
  }

  async clearSession(key: string): Promise<void> {
    const active = await this.verifiedActive();
    if (!active || active.key !== key) return;
    const cleared = await this.credentials.clearSession(
      this.target,
      key,
      active.token,
      this.epoch!,
      this.abort.signal,
      0,
    );
    this.assertActive();
    if (cleared) this.active = undefined;
  }

  removeStorageValue(key: string): Promise<void> {
    return this.clearSession(key);
  }

  async clearAllSessions(): Promise<void> {
    throw new Error("Global clear is unsupported in the OAuth experiment");
  }

  async listKeyPairs(): Promise<string[]> {
    const active = await this.verifiedActive();
    return [
      ...new Set([
        ...this.pendingClaims.keys(),
        ...(active ? [active.publicKey] : []),
      ]),
    ];
  }

  async deleteKeyPair(
    _publicKeyHex: string,
    _options?: DeleteKeyPairOptions,
  ): Promise<void> {
    throw new Error(
      "Pending-key cleanup is unsupported in the OAuth experiment",
    );
  }

  async sign(
    payload: string,
    publicKeyHex: string,
    format: SignatureFormat = SignatureFormat.Der,
  ): Promise<string> {
    const before = await this.verifiedActive();
    if (!before || before.publicKey !== publicKeyHex)
      throw new Error("API key is not owned by the active session");
    let privateKey: CryptoKey | undefined;
    await this.database.withCredentialRead(({ keys }) => {
      const request = keys.get(publicKeyHex);
      request.onsuccess = () => {
        privateKey = request.result;
      };
    });
    this.assertActive();
    if (!privateKey) throw new Error("Bound private key is missing");
    const input = new TextEncoder().encode(payload);
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        input,
      ),
    );
    const publicKey = await crypto.subtle.importKey(
      "raw",
      uncompressRawPublicKey(
        uint8ArrayFromHexString(publicKeyHex),
        "CURVE_P256",
      ),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        signature,
        input,
      ))
    )
      throw new Error("Bound private key does not match session public key");
    const after = await this.verifiedActive();
    if (
      after?.key !== before.key ||
      after.token !== before.token ||
      after.publicKey !== publicKeyHex
    )
      throw new Error("Bound session changed during signing");
    return uint8ArrayToHexString(
      format === SignatureFormat.Raw
        ? signature
        : convertEcdsaIeee1363ToDer(signature),
    );
  }

  async stamp(payload: string, publicKeyHex: string): Promise<TStamp> {
    const signature = await this.sign(payload, publicKeyHex);
    return {
      stampHeaderName: "X-Stamp",
      stampHeaderValue: stringToBase64urlString(
        JSON.stringify({
          publicKey: publicKeyHex,
          scheme: "SIGNATURE_SCHEME_TK_API_P256",
          signature,
        }),
      ),
    };
  }
}
