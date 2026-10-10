import {
  ZeroXKeyError,
  ZeroXKeyErrorCodes,
  type Session,
} from "@0xkey-io/sdk-types";
import { SessionKey, type StorageBase } from "../__types__";
import { parseSession } from "@utils";
import {
  AUTH_ROOT,
  prepareAuthStorage,
  type RawAuthStorage,
} from "./auth-reset";
import {
  boundTargetKey,
  emptyBoundRecord,
  readBoundRecord,
  type AtomicBoundSessionStore,
  type BoundAuthTarget,
  type BoundSessionRecord,
} from "./bound-session";

const ALL = `${AUTH_ROOT}meta/all-session-keys`;
const ACTIVE = `${AUTH_ROOT}meta/active-session-key`;
const sessionAddress = (key: string) => `${AUTH_ROOT}session/${key}`;

/** Default core authentication generation. Wallet cache storage is independent. */
export class AuthStorageManager implements StorageBase {
  private allowedSessionTokens: Map<string, string> | undefined;
  private authAccessRevoked = false;
  private authContextGuard?: () => boolean;
  private boundTarget?: { key: string; value: BoundAuthTarget };
  private readonly boundAbortController?: AbortController;
  constructor(
    private readonly raw: RawAuthStorage,
    private readonly atomicBoundStore?: AtomicBoundSessionStore,
  ) {
    if (atomicBoundStore) this.boundAbortController = new AbortController();
  }
  revokeAuthAccess = (): void => {
    this.authAccessRevoked = true;
    this.boundAbortController?.abort();
  };
  retireAuthAccess = async (): Promise<void> => {
    this.revokeAuthAccess();
    await this.atomicBoundStore?.retire?.();
  };
  retainsKeyPairOnClear = (): boolean => this.boundTarget !== undefined;
  setAuthContextGuard = (guard: () => boolean): void => {
    this.authContextGuard = guard;
  };
  private hasAuthAccess = (): boolean =>
    !this.authAccessRevoked && (this.authContextGuard?.() ?? true);
  private assertAuthAccess = (): void => {
    if (!this.hasAuthAccess())
      throw new ZeroXKeyError(
        "Client auth context changed",
        ZeroXKeyErrorCodes.CLIENT_NOT_INITIALIZED,
      );
  };
  restrictToNewSessions = (): void => {
    this.assertAuthAccess();
    this.allowedSessionTokens = new Map();
  };
  bindTarget = async (target: BoundAuthTarget): Promise<boolean> => {
    this.assertAuthAccess();
    if (!this.atomicBoundStore) return false;
    const value = { ...target };
    const key = boundTargetKey(value);
    const record = readBoundRecord(
      await this.atomicBoundStore.read(key),
      value,
    );
    this.assertAuthAccess();
    this.boundTarget = { key, value };
    this.allowedSessionTokens = new Map(
      record?.sessions.map(({ key, token }) => [key, token]) ?? [],
    );
    return true;
  };
  private readBound = async (): Promise<BoundSessionRecord | undefined> => {
    const target = this.boundTarget;
    if (!target || !this.atomicBoundStore || !this.hasAuthAccess())
      return undefined;
    const record = readBoundRecord(
      await this.atomicBoundStore.read(target.key),
      target.value,
    );
    return this.hasAuthAccess() ? record : undefined;
  };
  private transactBound = async (
    update: (current: BoundSessionRecord) => BoundSessionRecord,
  ): Promise<void> => {
    const target = this.boundTarget;
    if (!target || !this.atomicBoundStore)
      throw new Error("Bound session storage is unavailable");
    this.assertAuthAccess();
    await this.atomicBoundStore.transact(
      target.key,
      (current) => {
        this.assertAuthAccess();
        const record =
          readBoundRecord(current, target.value) ??
          emptyBoundRecord(target.value);
        return update(record);
      },
      this.boundAbortController!.signal,
    );
    this.assertAuthAccess();
  };
  private assertUnchangedBoundSession = (
    record: BoundSessionRecord,
    key: string,
  ): void => {
    const expected = this.allowedSessionTokens?.get(key);
    const actual = record.sessions.find((entry) => entry.key === key)?.token;
    if (expected !== actual)
      throw new ZeroXKeyError(
        "Session changed in another authentication context",
        ZeroXKeyErrorCodes.STORE_SESSION_ERROR,
      );
  };
  prepare = (): Promise<void> => prepareAuthStorage(this.raw);
  private read = async (key: string): Promise<any> => {
    if (!this.hasAuthAccess()) return undefined;
    const value = await this.raw.get(key);
    if (!this.hasAuthAccess()) return undefined;
    return value ? JSON.parse(value) : undefined;
  };
  private write = async (key: string, value: any): Promise<void> => {
    this.assertAuthAccess();
    if (value === undefined)
      throw new ZeroXKeyError(
        "Session value cannot be undefined",
        ZeroXKeyErrorCodes.STORE_SESSION_ERROR,
      );
    await this.raw.set(key, JSON.stringify(value));
    this.assertAuthAccess();
  };
  private rawSessionKeys = async (): Promise<string[]> => {
    const keys = await this.read(ALL);
    return Array.isArray(keys)
      ? keys.filter((key): key is string => typeof key === "string")
      : [];
  };
  getStorageValue = async (key: string): Promise<any> => {
    if (this.boundTarget) {
      const record = await this.readBound();
      const token = record?.sessions.find((entry) => entry.key === key)?.token;
      if (
        !token ||
        !this.allowedSessionTokens?.has(key) ||
        this.allowedSessionTokens.get(key) !== token ||
        !this.hasAuthAccess()
      )
        return undefined;
      return parseSession(token);
    }
    const value = await this.read(sessionAddress(key));
    if (!this.hasAuthAccess()) return undefined;
    if (this.allowedSessionTokens) {
      const allowedToken = this.allowedSessionTokens.get(key);
      if (
        !this.allowedSessionTokens.has(key) ||
        typeof allowedToken !== "string" ||
        allowedToken.length === 0 ||
        typeof value?.token !== "string" ||
        value.token.length === 0 ||
        allowedToken !== value.token
      )
        return undefined;
    }
    return value;
  };
  setStorageValue = async (key: string, value: any): Promise<void> => {
    if (this.boundTarget) {
      const token = value?.token;
      if (typeof token !== "string" || !token.length)
        throw new ZeroXKeyError(
          "Session token is required",
          ZeroXKeyErrorCodes.STORE_SESSION_ERROR,
        );
      parseSession(token);
      await this.transactBound((record) => {
        this.assertUnchangedBoundSession(record, key);
        return {
          ...record,
          sessions: [
            ...record.sessions.filter((entry) => entry.key !== key),
            { key, token },
          ],
        };
      });
      this.allowedSessionTokens?.set(key, token);
      return;
    }
    await this.write(sessionAddress(key), value);
  };
  removeStorageValue = async (key: string): Promise<void> => {
    this.assertAuthAccess();
    if (this.boundTarget) {
      const expectedToken = this.allowedSessionTokens?.get(key);
      if (!expectedToken) return;
      await this.transactBound((record) => {
        if (
          record.sessions.find((entry) => entry.key === key)?.token !==
          expectedToken
        )
          return record;
        return {
          ...record,
          sessions: record.sessions.filter((entry) => entry.key !== key),
          activeSessionKey:
            record.activeSessionKey === key
              ? undefined
              : record.activeSessionKey,
        };
      });
      this.allowedSessionTokens?.delete(key);
      return;
    }
    if (this.allowedSessionTokens && !(await this.getSession(key))) return;
    this.assertAuthAccess();
    await this.raw.remove(sessionAddress(key));
    this.assertAuthAccess();
    this.allowedSessionTokens?.delete(key);
  };
  setActiveSessionKey = async (key: string): Promise<void> => {
    this.assertAuthAccess();
    if (this.boundTarget) {
      const expectedToken = this.allowedSessionTokens?.get(key);
      if (!expectedToken)
        throw new ZeroXKeyError(
          "Session is not bound to this client",
          ZeroXKeyErrorCodes.NO_SESSION_FOUND,
        );
      await this.transactBound((record) => {
        if (
          record.sessions.find((entry) => entry.key === key)?.token !==
          expectedToken
        )
          throw new ZeroXKeyError(
            "Session is not bound to this client",
            ZeroXKeyErrorCodes.NO_SESSION_FOUND,
          );
        return { ...record, activeSessionKey: key };
      });
      return;
    }
    if (this.allowedSessionTokens && !(await this.getSession(key))) {
      throw new ZeroXKeyError(
        "Session is not bound to this client",
        ZeroXKeyErrorCodes.NO_SESSION_FOUND,
      );
    }
    await this.write(ACTIVE, key);
  };
  getActiveSessionKey = async (): Promise<string | undefined> => {
    if (this.boundTarget) {
      const record = await this.readBound();
      const key = record?.activeSessionKey;
      const token = record?.sessions.find((entry) => entry.key === key)?.token;
      return key &&
        token &&
        this.allowedSessionTokens?.get(key) === token &&
        this.hasAuthAccess()
        ? key
        : undefined;
    }
    const key = await this.read(ACTIVE);
    const permitted =
      key && this.allowedSessionTokens && !(await this.getSession(key))
        ? undefined
        : key;
    return this.hasAuthAccess() ? permitted : undefined;
  };
  getSession = (
    key: string = SessionKey.DefaultSessionkey,
  ): Promise<Session | undefined> => this.getStorageValue(key);
  getActiveSession = async (): Promise<Session | undefined> => {
    if (this.boundTarget) {
      const record = await this.readBound();
      const key = record?.activeSessionKey;
      const token = record?.sessions.find((entry) => entry.key === key)?.token;
      return key &&
        token &&
        this.allowedSessionTokens?.get(key) === token &&
        this.hasAuthAccess()
        ? parseSession(token)
        : undefined;
    }
    const key = await this.getActiveSessionKey();
    const session = key ? await this.getSession(key) : undefined;
    return this.hasAuthAccess() ? session : undefined;
  };
  listSessionKeys = async (): Promise<string[]> => {
    if (this.boundTarget) {
      const record = await this.readBound();
      return this.hasAuthAccess()
        ? (record?.sessions ?? [])
            .filter(
              ({ key, token }) => this.allowedSessionTokens?.get(key) === token,
            )
            .map(({ key }) => key)
        : [];
    }
    const validKeys = await this.rawSessionKeys();
    if (!this.allowedSessionTokens)
      return this.hasAuthAccess() ? validKeys : [];
    const permitted = (
      await Promise.all(
        validKeys.map(async (key) =>
          (await this.getSession(key)) ? key : undefined,
        ),
      )
    ).filter((key): key is string => !!key);
    return this.hasAuthAccess() ? permitted : [];
  };
  storeSession = async (
    token: string,
    key: string = SessionKey.DefaultSessionkey,
  ): Promise<void> => {
    this.assertAuthAccess();
    if (this.boundTarget) {
      parseSession(token);
      await this.transactBound((record) => {
        this.assertUnchangedBoundSession(record, key);
        return {
          ...record,
          sessions: [
            ...record.sessions.filter((entry) => entry.key !== key),
            { key, token },
          ],
          activeSessionKey: key,
        };
      });
      this.allowedSessionTokens?.set(key, token);
      return;
    }
    await this.setStorageValue(key, parseSession(token));
    this.assertAuthAccess();
    const sessionKeys = await this.rawSessionKeys();
    if (!sessionKeys.includes(key))
      await this.write(ALL, [...sessionKeys, key]);
    await this.write(ACTIVE, key);
    this.assertAuthAccess();
    this.allowedSessionTokens?.set(key, token);
  };
  clearSession = async (key: string): Promise<void> => {
    this.assertAuthAccess();
    if (this.boundTarget) {
      await this.removeStorageValue(key);
      return;
    }
    if (this.allowedSessionTokens && !(await this.getSession(key))) return;
    await this.removeStorageValue(key);
    await this.write(
      ALL,
      (await this.rawSessionKeys()).filter((k) => k !== key),
    );
    if ((await this.read(ACTIVE)) === key) await this.raw.remove(ACTIVE);
  };
  clearAllSessions = async (): Promise<void> => {
    this.assertAuthAccess();
    if (this.allowedSessionTokens) {
      for (const key of await this.listSessionKeys())
        await this.clearSession(key);
      return;
    }
    await Promise.all(
      (await this.listSessionKeys()).map(this.removeStorageValue),
    );
    await this.raw.remove(ALL);
    await this.raw.remove(ACTIVE);
  };
}
