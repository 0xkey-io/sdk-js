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

const ALL = `${AUTH_ROOT}meta/all-session-keys`;
const ACTIVE = `${AUTH_ROOT}meta/active-session-key`;
const sessionAddress = (key: string) => `${AUTH_ROOT}session/${key}`;

/** Default core authentication generation. Wallet cache storage is independent. */
export class AuthStorageManager implements StorageBase {
  constructor(private readonly raw: RawAuthStorage) {}
  prepare = (): Promise<void> => prepareAuthStorage(this.raw);
  private read = async (key: string): Promise<any> => {
    const value = await this.raw.get(key);
    return value ? JSON.parse(value) : undefined;
  };
  private write = async (key: string, value: any): Promise<void> => {
    if (value === undefined)
      throw new ZeroXKeyError(
        "Session value cannot be undefined",
        ZeroXKeyErrorCodes.STORE_SESSION_ERROR,
      );
    await this.raw.set(key, JSON.stringify(value));
  };
  getStorageValue = (key: string): Promise<any> =>
    this.read(sessionAddress(key));
  setStorageValue = (key: string, value: any): Promise<void> =>
    this.write(sessionAddress(key), value);
  removeStorageValue = (key: string): Promise<void> =>
    this.raw.remove(sessionAddress(key));
  setActiveSessionKey = (key: string): Promise<void> => this.write(ACTIVE, key);
  getActiveSessionKey = (): Promise<string | undefined> => this.read(ACTIVE);
  getSession = (
    key: string = SessionKey.DefaultSessionkey,
  ): Promise<Session | undefined> => this.getStorageValue(key);
  getActiveSession = async (): Promise<Session | undefined> => {
    const key = await this.getActiveSessionKey();
    return key ? this.getSession(key) : undefined;
  };
  listSessionKeys = async (): Promise<string[]> => {
    const keys = await this.read(ALL);
    return Array.isArray(keys)
      ? keys.filter((key): key is string => typeof key === "string")
      : [];
  };
  storeSession = async (
    token: string,
    key: string = SessionKey.DefaultSessionkey,
  ): Promise<void> => {
    await this.setStorageValue(key, parseSession(token));
    const keys = await this.listSessionKeys();
    if (!keys.includes(key)) await this.write(ALL, [...keys, key]);
    await this.setActiveSessionKey(key);
  };
  clearSession = async (key: string): Promise<void> => {
    await this.removeStorageValue(key);
    await this.write(
      ALL,
      (await this.listSessionKeys()).filter((k) => k !== key),
    );
    if ((await this.getActiveSessionKey()) === key)
      await this.raw.remove(ACTIVE);
  };
  clearAllSessions = async (): Promise<void> => {
    await Promise.all(
      (await this.listSessionKeys()).map(this.removeStorageValue),
    );
    await this.raw.remove(ALL);
    await this.raw.remove(ACTIVE);
  };
}
