const LEGACY_PREFIX = "com.0xkey.keypair:";

/** Uses exact services only; never invokes a stamper's fallback lookup. */
export async function cleanupLegacyNativeKeys(
  publicKeys: string[],
): Promise<void> {
  const keychain: typeof import("react-native-keychain") = require("react-native-keychain");
  const remove = async (service: string) => {
    let removed = false;
    try {
      removed = await keychain.resetGenericPassword({ service });
    } catch {
      /* Only confirmed exact absence makes a failed reset idempotent. */
    }
    if (!removed && (await keychain.getGenericPassword({ service })))
      throw new Error("Legacy key deletion failed");
  };
  for (const service of await keychain.getAllGenericPasswordServices()) {
    if (service.startsWith(LEGACY_PREFIX)) await remove(service);
  }
  for (const publicKey of publicKeys) {
    if (!/^(?:0[23][a-fA-F0-9]{64}|04[a-fA-F0-9]{128})$/.test(publicKey))
      continue;
    const credential = await keychain.getGenericPassword({
      service: publicKey,
    });
    if (credential && credential.username === publicKey)
      await remove(publicKey);
  }
}
