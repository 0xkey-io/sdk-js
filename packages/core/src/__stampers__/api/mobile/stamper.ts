import { ApiKeyStamper, SignatureFormat } from "@0xkey-io/api-key-stamper";
import { generateP256KeyPair } from "@0xkey-io/crypto";
import type {
  TStamp,
  ApiKeyStamperBase,
  DeleteKeyPairOptions,
} from "../../../__types__";

let Keychain: typeof import("react-native-keychain");

try {
  Keychain = require("react-native-keychain");
} catch {
  throw new Error(
    "Please install react-native-keychain in your app to use ReactNativeKeychainStamper",
  );
}

// Authentication v2 never reads or imports an earlier key generation.
const ZEROXKEY_KEY_PREFIX = "com.0xkey.auth.v2.keypair:";

export class ReactNativeKeychainStamper implements ApiKeyStamperBase {
  private serviceName(publicKeyHex: string): string {
    return `${ZEROXKEY_KEY_PREFIX}${publicKeyHex}`;
  }

  async listKeyPairs(): Promise<string[]> {
    const allServices = await Keychain.getAllGenericPasswordServices();
    return allServices
      .filter((service: string) => service.startsWith(ZEROXKEY_KEY_PREFIX))
      .map((service: string) => service.slice(ZEROXKEY_KEY_PREFIX.length));
  }

  async createKeyPair(externalKeyPair?: {
    publicKey: string;
    privateKey: string;
  }): Promise<string> {
    let privateKey: string;
    let publicKey: string;

    if (externalKeyPair) {
      privateKey = externalKeyPair.privateKey;
      publicKey = externalKeyPair.publicKey;
    } else {
      const pair = generateP256KeyPair();
      privateKey = pair.privateKey;
      publicKey = pair.publicKey;
    }

    // we store in Keychain with a
    // ZeroXKey-specific service prefix
    await Keychain.setGenericPassword(publicKey, privateKey, {
      service: this.serviceName(publicKey),
    });

    return publicKey;
  }

  async deleteKeyPair(
    publicKeyHex: string,
    _options?: DeleteKeyPairOptions,
  ): Promise<void> {
    const service = this.serviceName(publicKeyHex);
    const deleted = await Keychain.resetGenericPassword({ service });
    if (!deleted && (await Keychain.getGenericPassword({ service }))) {
      throw new Error("Failed to delete exact key pair");
    }
  }

  private async getPrivateKey(publicKeyHex: string): Promise<string | null> {
    const credentials = await Keychain.getGenericPassword({
      service: this.serviceName(publicKeyHex),
    });
    return credentials ? credentials.password : null;
  }

  async stamp(payload: string, publicKeyHex: string): Promise<TStamp> {
    const privateKey = await this.getPrivateKey(publicKeyHex);
    if (!privateKey) {
      throw new Error(`No private key found for public key: ${publicKeyHex}`);
    }
    const stamper = new ApiKeyStamper({
      apiPublicKey: publicKeyHex,
      apiPrivateKey: privateKey,
    });
    const { stampHeaderName, stampHeaderValue } = await stamper.stamp(payload);
    return { stampHeaderName, stampHeaderValue };
  }

  async sign(
    payload: string,
    publicKeyHex: string,
    format: SignatureFormat,
  ): Promise<string> {
    const privateKey = await this.getPrivateKey(publicKeyHex);
    if (!privateKey) {
      throw new Error(`No private key found for public key: ${publicKeyHex}`);
    }
    const stamper = new ApiKeyStamper({
      apiPublicKey: publicKeyHex,
      apiPrivateKey: privateKey,
    });

    switch (format) {
      case SignatureFormat.Raw: {
        return stamper.sign(payload, SignatureFormat.Raw);
      }
      case SignatureFormat.Der:
        return stamper.sign(payload, SignatureFormat.Der);
      default:
        throw new Error(`Unsupported signature format: ${format}`);
    }
  }
}
