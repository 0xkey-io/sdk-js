import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-native-keychain", () => ({
  getAllGenericPasswordServices: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

jest.mock("@0xkey-io/crypto", () => {
  const actual = jest.requireActual(
    "@0xkey-io/crypto",
  ) as typeof import("@0xkey-io/crypto");

  return {
    ...actual,
    generateP256KeyPair: jest.fn(),
  };
});

import { generateP256KeyPair } from "@0xkey-io/crypto";
import { ReactNativeKeychainStamper } from "../__stampers__/api/mobile/stamper";

type KeyPair = { publicKey: string; privateKey: string };

const Keychain = jest.requireMock("react-native-keychain") as {
  getAllGenericPasswordServices: jest.Mock<() => Promise<string[]>>;
  getGenericPassword: jest.Mock<() => Promise<false>>;
  resetGenericPassword: jest.Mock<() => Promise<boolean>>;
  setGenericPassword: jest.Mock<
    (
      username: string,
      password: string,
      options: { service: string },
    ) => Promise<false | { service: string; storage: string }>
  >;
};

const mockGenerateP256KeyPair = jest.mocked(generateP256KeyPair);
const MODERN_PREFIX = "com.0xkey.auth.v2.keypair:";
const WRITE_FAILURE_MESSAGE = "Failed to store key pair";
const generatedKeyPair = {
  publicKey: "generated-public-key-sentinel",
  publicKeyUncompressed: "generated-uncompressed-public-key-sentinel",
  privateKey: "generated-private-key-sentinel",
};
const suppliedKeyPair = {
  publicKey: "supplied-public-key-sentinel",
  privateKey: "supplied-private-key-sentinel",
};

function expectExactWriteOnly(keyPair: KeyPair, generated: boolean): void {
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
    keyPair.publicKey,
    keyPair.privateKey,
    { service: `${MODERN_PREFIX}${keyPair.publicKey}` },
  );
  expect(Keychain.getAllGenericPasswordServices).not.toHaveBeenCalled();
  expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
  expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
  expect(mockGenerateP256KeyPair).toHaveBeenCalledTimes(generated ? 1 : 0);
}

describe.each([
  {
    path: "generated key pair",
    keyPair: generatedKeyPair,
    generated: true,
    create: (stamper: ReactNativeKeychainStamper) => stamper.createKeyPair(),
  },
  {
    path: "supplied key pair",
    keyPair: suppliedKeyPair,
    generated: false,
    create: (stamper: ReactNativeKeychainStamper) =>
      stamper.createKeyPair(suppliedKeyPair),
  },
])("ReactNativeKeychainStamper creation with a $path", (testCase) => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateP256KeyPair.mockReturnValue(generatedKeyPair);
  });

  it("rejects a false native write result with a fixed sanitized error", async () => {
    Keychain.setGenericPassword.mockResolvedValue(false);
    const stamper = new ReactNativeKeychainStamper();
    let caught: unknown;

    try {
      await testCase.create(stamper);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(WRITE_FAILURE_MESSAGE);
    expect((caught as Error).message.includes(testCase.keyPair.publicKey)).toBe(
      false,
    );
    expect(
      (caught as Error).message.includes(testCase.keyPair.privateKey),
    ).toBe(false);
    expectExactWriteOnly(testCase.keyPair, testCase.generated);
  });

  it("returns the public key after a truthy native success result", async () => {
    Keychain.setGenericPassword.mockResolvedValue({
      service: `${MODERN_PREFIX}${testCase.keyPair.publicKey}`,
      storage: "synthetic-storage",
    });
    const stamper = new ReactNativeKeychainStamper();

    await expect(testCase.create(stamper)).resolves.toBe(
      testCase.keyPair.publicKey,
    );

    expectExactWriteOnly(testCase.keyPair, testCase.generated);
  });

  it("preserves a thrown native write error by identity", async () => {
    const nativeError = new Error("synthetic native write failure");
    Keychain.setGenericPassword.mockRejectedValue(nativeError);
    const stamper = new ReactNativeKeychainStamper();

    await expect(testCase.create(stamper)).rejects.toBe(nativeError);

    expectExactWriteOnly(testCase.keyPair, testCase.generated);
  });
});
