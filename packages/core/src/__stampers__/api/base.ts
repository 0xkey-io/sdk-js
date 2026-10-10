import { isReactNative, isWeb } from "@utils";
import { IndexedDbStamper } from "./web/stamper";
import type {
  TStamp,
  TStamper,
  StorageBase,
  ApiKeyStamperBase,
  DeleteKeyPairOptions,
} from "../../__types__";
import { ZeroXKeyError, ZeroXKeyErrorCodes } from "@0xkey-io/sdk-types";
import { SignatureFormat } from "@0xkey-io/api-key-stamper";

/**
 * Cross-platform API key stamper.
 *
 * - This stamper uses indexedDB on web and keychain on react-native to securely stamp ZeroXKey requests.
 * - ***Only supports P-256 ECDSA key pairs.***
 */
export class CrossPlatformApiKeyStamper implements TStamper {
  private stamper?: ApiKeyStamperBase;
  private temporaryPublicKey?: string | undefined;
  private authAccessRevoked = false;
  private authContextGuard?: () => boolean;
  constructor(
    private storageManager: StorageBase,
    private readonly webOptInStamper?: ApiKeyStamperBase,
  ) {
    // Use init method to set up the stamper based on the platform. It's async, so can't be done in the constructor.
  }

  revokeAuthAccess(): void {
    this.authAccessRevoked = true;
    this.temporaryPublicKey = undefined;
  }

  setAuthContextGuard(guard: () => boolean): void {
    this.authContextGuard = guard;
  }

  private assertAuthAccess(): void {
    if (this.authAccessRevoked || this.authContextGuard?.() === false)
      throw new ZeroXKeyError(
        "Client auth context changed",
        ZeroXKeyErrorCodes.CLIENT_NOT_INITIALIZED,
      );
  }

  async init(): Promise<void> {
    if (isWeb()) {
      this.stamper = this.webOptInStamper ?? new IndexedDbStamper();
    } else if (isReactNative()) {
      try {
        // Dynamic import to prevent bundling the native module in web environments.
        const { ReactNativeKeychainStamper } = await import("./mobile/stamper");
        this.stamper = new ReactNativeKeychainStamper();
      } catch (error) {
        throw new ZeroXKeyError(
          `Failed to load keychain stamper for react-native`,
          ZeroXKeyErrorCodes.INITIALIZE_CLIENT_ERROR,
          error,
        );
      }
    } else {
      throw new ZeroXKeyError(
        "Unsupported platform for API key stamper",
        ZeroXKeyErrorCodes.UNSUPPORTED_PLATFORM,
      );
    }
  }

  listKeyPairs(): Promise<string[]> {
    if (!this.stamper) {
      throw new ZeroXKeyError(
        "Stamper is not initialized. Please call .init() before calling this method.",
        ZeroXKeyErrorCodes.CLIENT_NOT_INITIALIZED,
      );
    }
    return this.stamper.listKeyPairs();
  }

  createKeyPair(
    externalKeyPair?: CryptoKeyPair | { publicKey: string; privateKey: string },
  ): Promise<string> {
    if (!this.stamper) {
      throw new ZeroXKeyError(
        "Stamper is not initialized. Please call .init() before calling this method.",
        ZeroXKeyErrorCodes.CLIENT_NOT_INITIALIZED,
      );
    }
    return this.stamper.createKeyPair(externalKeyPair);
  }

  async deleteKeyPair(
    publicKeyHex: string,
    options?: DeleteKeyPairOptions,
  ): Promise<void> {
    if (!this.stamper) {
      throw new ZeroXKeyError(
        "Stamper is not initialized. Please call .init() before calling this method.",
        ZeroXKeyErrorCodes.CLIENT_NOT_INITIALIZED,
      );
    }

    await this.stamper.deleteKeyPair(publicKeyHex, options);

    // Preserve the override when deletion fails so an exact retry remains possible.
    if (this.temporaryPublicKey === publicKeyHex) {
      this.temporaryPublicKey = undefined;
    }
  }

  // This allows forcing a specific public key to find the key pair for stamping. The key pair must already exist in indexedDB / Keychain.
  // This is useful if you need to stamp with a specific key pair without having an active session.
  // See "signUpWithPasskey" function in core.ts for usage
  setTemporaryPublicKey(publicKeyHex: string | undefined): void {
    this.temporaryPublicKey = publicKeyHex;
  }

  getTemporaryPublicKey(): string | undefined {
    return this.temporaryPublicKey;
  }

  clearTemporaryPublicKey(): void {
    this.temporaryPublicKey = undefined;
  }

  async stamp(payload: string): Promise<TStamp> {
    this.assertAuthAccess();
    if (!this.stamper) {
      throw new ZeroXKeyError(
        "Stamper is not initialized. Please call .init() before calling this method.",
        ZeroXKeyErrorCodes.CLIENT_NOT_INITIALIZED,
      );
    }
    let publicKeyHex = this.temporaryPublicKey;
    if (!publicKeyHex) {
      const session = await this.storageManager.getActiveSession();
      this.assertAuthAccess();
      if (!session) {
        throw new ZeroXKeyError(
          "No active session or token available.",
          ZeroXKeyErrorCodes.NO_SESSION_FOUND,
        );
      }
      publicKeyHex = session.publicKey!;
    }

    const stamp = await this.stamper.stamp(payload, publicKeyHex);
    this.assertAuthAccess();
    return stamp;
  }

  async sign(
    payload: string,
    format: SignatureFormat = SignatureFormat.Der,
    explicitPublicKey?: string,
  ): Promise<string> {
    this.assertAuthAccess();
    if (!this.stamper) {
      throw new ZeroXKeyError(
        "Stamper is not initialized. Please call .init() before calling this method.",
        ZeroXKeyErrorCodes.CLIENT_NOT_INITIALIZED,
      );
    }
    let publicKeyHex = explicitPublicKey ?? this.temporaryPublicKey;
    if (!publicKeyHex) {
      const session = await this.storageManager.getActiveSession();
      this.assertAuthAccess();
      if (!session) {
        throw new ZeroXKeyError(
          "No active session or token available.",
          ZeroXKeyErrorCodes.NO_SESSION_FOUND,
        );
      }
      publicKeyHex = session.publicKey!;
    }

    const signature = await this.stamper.sign(payload, publicKeyHex, format);
    this.assertAuthAccess();
    return signature;
  }
}
