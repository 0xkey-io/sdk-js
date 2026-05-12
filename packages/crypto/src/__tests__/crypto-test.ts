import { test, expect, describe } from "@jest/globals";
import {
  uint8ArrayFromHexString,
  uint8ArrayToHexString,
  bs58check,
} from "@0xkey-io/encoding";
import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";
import {
  getPublicKey,
  generateP256KeyPair,
  decryptCredentialBundle,
  extractPrivateKeyFromPKCS8Bytes,
  uncompressRawPublicKey,
  compressRawPublicKey,
  hpkeDecrypt,
  hpkeEncrypt,
  decryptExportBundle,
  hpkeAuthEncrypt,
  formatHpkeBuf,
  verifyStampSignature,
  verifySessionJwtSignature,
  fromDerSignature,
} from "../";

const ZEROXKEY_HPKE_INFO = "0xkey_hpke";

describe("HPKE Encryption and Decryption", () => {
  test("hpkeAuthEncrypt and hpkeDecrypt - end-to-end encryption and decryption", () => {
    const senderKeyPair = generateP256KeyPair();
    const receiverKeyPair = generateP256KeyPair();
    const receiverPublicKeyUncompressed = uncompressRawPublicKey(
      uint8ArrayFromHexString(receiverKeyPair.publicKey),
    );

    const textEncoder = new TextEncoder();
    // Mock plaintext
    const plainText = "Hello, this is a secure message!";
    const plainTextBuf = textEncoder.encode(plainText);
    // Encrypt
    const encryptedDataBuf = hpkeAuthEncrypt({
      plainTextBuf: plainTextBuf,
      targetKeyBuf: receiverPublicKeyUncompressed,
      senderPriv: senderKeyPair.privateKey,
    });
    const encryptedData = formatHpkeBuf(encryptedDataBuf);
    // Extract the encapsulated key buffer and the ciphertext
    const data = JSON.parse(encryptedData);
    // Decrypt
    const decryptedData = hpkeDecrypt({
      ciphertextBuf: uint8ArrayFromHexString(data.ciphertext),
      encappedKeyBuf: uint8ArrayFromHexString(data.encappedPublic),
      receiverPriv: receiverKeyPair.privateKey,
    });

    // Convert decrypted data back to string
    const decryptedText = new TextDecoder().decode(decryptedData);

    // Expect the decrypted text to equal the original plaintext
    expect(decryptedText).toEqual(plainText);
  });
});

describe("HPKE Standard Encryption and Decryption", () => {
  test("hpkeEncrypt and hpkeDecrypt - standard mode (ephemeral sender key)", async () => {
    // Generate a receiver key pair
    const receiverKeyPair = generateP256KeyPair();
    const receiverPublicKeyUncompressed = uncompressRawPublicKey(
      uint8ArrayFromHexString(receiverKeyPair.publicKey),
    );

    // Prepare the plaintext
    const textEncoder = new TextEncoder();
    const plainText =
      "6ab33bd6e4bdc73017233da0554f9616fe10ede5c3ce001e81b321d5a74199b7";
    const plainTextBuf = textEncoder.encode(plainText);

    // Encrypt using standard mode (no sender private key provided)
    const encryptedDataBuf = hpkeEncrypt({
      plainTextBuf: plainTextBuf,
      targetKeyBuf: receiverPublicKeyUncompressed,
      // No senderPriv provided, so it will use an ephemeral key
    });
    const encryptedData = formatHpkeBuf(encryptedDataBuf);
    // Parse the encrypted data
    const data = JSON.parse(encryptedData);
    // Decrypt the message
    const decryptedData = hpkeDecrypt({
      ciphertextBuf: uint8ArrayFromHexString(data.ciphertext),
      encappedKeyBuf: uint8ArrayFromHexString(data.encappedPublic),
      receiverPriv: receiverKeyPair.privateKey,
    });

    // Convert decrypted data back to string
    const decryptedText = new TextDecoder().decode(decryptedData);

    // Verify that the decrypted text matches the original plaintext
    expect(decryptedText).toEqual(plainText);

    // Additional checks to ensure standard mode behavior
    const encappedPublicKey = uint8ArrayFromHexString(data.encappedPublic);
    expect(encappedPublicKey.length).toBe(65); // Uncompressed public key length
    expect(encappedPublicKey[0]).toBe(0x04); // Uncompressed public key prefix
  });
});

describe("HPKE info isolation", () => {
  // Assert that the 0xkey_hpke schedule is isolated from the legacy schedule.
  // Legacy ciphertext must not decrypt on the 0xkey path (and vice versa).
  const plainText = "0xkey-hpke-info-isolation-roundtrip-fixture";
  const otherInfo = "different_info";

  test("0xkey_hpke roundtrip succeeds", () => {
    const receiver = generateP256KeyPair();
    const targetKey = uncompressRawPublicKey(
      uint8ArrayFromHexString(receiver.publicKey),
    );
    const plainTextBuf = new TextEncoder().encode(plainText);

    const encrypted = hpkeEncrypt({
      plainTextBuf,
      targetKeyBuf: targetKey,
      hpkeInfo: ZEROXKEY_HPKE_INFO,
    });
    const formatted = JSON.parse(formatHpkeBuf(encrypted));

    const decrypted = hpkeDecrypt({
      ciphertextBuf: uint8ArrayFromHexString(formatted.ciphertext),
      encappedKeyBuf: uint8ArrayFromHexString(formatted.encappedPublic),
      receiverPriv: receiver.privateKey,
      hpkeInfo: ZEROXKEY_HPKE_INFO,
    });

    expect(new TextDecoder().decode(decrypted)).toEqual(plainText);
  });

  test("ciphertext from 0xkey_hpke cannot be decrypted via legacy schedule", () => {
    const receiver = generateP256KeyPair();
    const targetKey = uncompressRawPublicKey(
      uint8ArrayFromHexString(receiver.publicKey),
    );
    const plainTextBuf = new TextEncoder().encode(plainText);

    const encrypted = hpkeEncrypt({
      plainTextBuf,
      targetKeyBuf: targetKey,
      hpkeInfo: ZEROXKEY_HPKE_INFO,
    });
    const formatted = JSON.parse(formatHpkeBuf(encrypted));

    expect(() =>
      hpkeDecrypt({
        ciphertextBuf: uint8ArrayFromHexString(formatted.ciphertext),
        encappedKeyBuf: uint8ArrayFromHexString(formatted.encappedPublic),
        receiverPriv: receiver.privateKey,
        // Omitting hpkeInfo selects the legacy schedule; key derivation differs.
      }),
    ).toThrow();
  });

  test("ciphertext from legacy schedule cannot be decrypted via 0xkey_hpke", () => {
    const receiver = generateP256KeyPair();
    const targetKey = uncompressRawPublicKey(
      uint8ArrayFromHexString(receiver.publicKey),
    );
    const plainTextBuf = new TextEncoder().encode(plainText);

    const encrypted = hpkeEncrypt({
      plainTextBuf,
      targetKeyBuf: targetKey,
      // legacy schedule (no hpkeInfo)
    });
    const formatted = JSON.parse(formatHpkeBuf(encrypted));

    expect(() =>
      hpkeDecrypt({
        ciphertextBuf: uint8ArrayFromHexString(formatted.ciphertext),
        encappedKeyBuf: uint8ArrayFromHexString(formatted.encappedPublic),
        receiverPriv: receiver.privateKey,
        hpkeInfo: ZEROXKEY_HPKE_INFO,
      }),
    ).toThrow();
  });

  test("different info strings produce incompatible schedules", () => {
    const receiver = generateP256KeyPair();
    const targetKey = uncompressRawPublicKey(
      uint8ArrayFromHexString(receiver.publicKey),
    );
    const plainTextBuf = new TextEncoder().encode(plainText);

    const encrypted = hpkeEncrypt({
      plainTextBuf,
      targetKeyBuf: targetKey,
      hpkeInfo: ZEROXKEY_HPKE_INFO,
    });
    const formatted = JSON.parse(formatHpkeBuf(encrypted));

    expect(() =>
      hpkeDecrypt({
        ciphertextBuf: uint8ArrayFromHexString(formatted.ciphertext),
        encappedKeyBuf: uint8ArrayFromHexString(formatted.encappedPublic),
        receiverPriv: receiver.privateKey,
        hpkeInfo: otherInfo,
      }),
    ).toThrow();
  });
});

describe("decryptExportBundle Tests", () => {
  // Hard-coded legacy fixtures cannot be decoded by 0xkey-native helpers. Use an
  // end-to-end round trip: hpkeEncrypt produces a 0xkey bundle, then the helper
  // verifies and decrypts it.
  const organizationId = "11111111-2222-3333-4444-555555555555";
  const expectedMnemonic =
    "leaf lady until indicate praise final route toast cake minimum insect unknown";
  const mnemonicHex = uint8ArrayToHexString(
    new TextEncoder().encode(expectedMnemonic),
  );

  const buildExportBundle = (overrideOrgId?: string) => {
    const receiver = generateP256KeyPair();
    const signer = generateP256KeyPair();

    const encrypted = hpkeEncrypt({
      plainTextBuf: new TextEncoder().encode(expectedMnemonic),
      targetKeyBuf: uncompressRawPublicKey(
        uint8ArrayFromHexString(receiver.publicKey),
      ),
      hpkeInfo: ZEROXKEY_HPKE_INFO,
    });
    const formatted = JSON.parse(formatHpkeBuf(encrypted));

    const signedData = JSON.stringify({
      encappedPublic: formatted.encappedPublic,
      ciphertext: formatted.ciphertext,
      organizationId: overrideOrgId ?? organizationId,
    });
    const signedDataBytes = new TextEncoder().encode(signedData);
    const dataHex = uint8ArrayToHexString(signedDataBytes);
    const digest = sha256(signedDataBytes);
    const dataSignature = p256
      .sign(digest, uint8ArrayFromHexString(signer.privateKey))
      .toDERHex();

    const exportBundle = JSON.stringify({
      version: "v1.0.0",
      data: dataHex,
      dataSignature,
      enclaveQuorumPublic: signer.publicKeyUncompressed,
    });

    return {
      exportBundle,
      embeddedKey: receiver.privateKey,
      signerOverride: signer.publicKeyUncompressed,
    };
  };

  test("decryptExportBundle successfully decrypts a valid bundle - mnemonic", async () => {
    const { exportBundle, embeddedKey, signerOverride } = buildExportBundle();

    const result = await decryptExportBundle({
      exportBundle,
      embeddedKey,
      organizationId,
      dangerouslyOverrideSignerPublicKey: signerOverride,
      keyFormat: "HEXADECIMAL",
      returnMnemonic: true,
    });

    expect(result).toEqual(expectedMnemonic);
  });

  test("decryptExportBundle successfully decrypts a valid bundle - non-mnemonic", async () => {
    const { exportBundle, embeddedKey, signerOverride } = buildExportBundle();

    const result = await decryptExportBundle({
      exportBundle,
      embeddedKey,
      organizationId,
      dangerouslyOverrideSignerPublicKey: signerOverride,
      keyFormat: "HEXADECIMAL",
      returnMnemonic: false,
    });

    expect(result).toEqual(mnemonicHex);
  });

  test("decryptExportBundle rejects org-id mismatch", async () => {
    const { exportBundle, embeddedKey, signerOverride } = buildExportBundle(
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    );

    await expect(
      decryptExportBundle({
        exportBundle,
        embeddedKey,
        organizationId,
        dangerouslyOverrideSignerPublicKey: signerOverride,
        keyFormat: "HEXADECIMAL",
        returnMnemonic: true,
      }),
    ).rejects.toThrow(/organization id does not match/);
  });
});

describe("ZeroXKey Crypto Primitives", () => {
  test("getPublicKey - returns the correct public key", () => {
    const keyPair = generateP256KeyPair();
    const publicKey = getPublicKey(
      uint8ArrayFromHexString(keyPair.privateKey),
      true,
    );
    expect(publicKey).toHaveLength(33);
  });

  test("generateP256KeyPair - generates a valid key pair", () => {
    const keyPair = generateP256KeyPair();
    expect(keyPair.privateKey).toBeTruthy();
    expect(keyPair.publicKey).toBeTruthy();
    expect(keyPair.publicKeyUncompressed).toBeTruthy();
    expect(keyPair.privateKey).not.toEqual(keyPair.publicKey);
    expect(keyPair.publicKey).not.toEqual(keyPair.publicKeyUncompressed);
  });

  test("compressRawPublicKey - returns a valid value", () => {
    const { publicKey, publicKeyUncompressed } = generateP256KeyPair();
    expect(
      compressRawPublicKey(uint8ArrayFromHexString(publicKeyUncompressed)),
    ).toEqual(uint8ArrayFromHexString(publicKey));
  });

  test("decryptCredentialBundle - successfully decrypts a credential bundle", () => {
    // Legacy fixtures are not decryptable via 0xkey_hpke. Round-trip instead:
    // hpkeEncrypt builds a 0xkey bundle; the helper decrypts it. hpkeEncrypt
    // generates a temporary sender keypair, so senderPriv is not required here.
    const receiver = generateP256KeyPair();
    const plaintextHex =
      "67ee05fc3bdf4161bc70701c221d8d77180294cefcfcea64ba83c4d4c732fcb9";

    const encrypted = hpkeEncrypt({
      plainTextBuf: uint8ArrayFromHexString(plaintextHex),
      targetKeyBuf: uncompressRawPublicKey(
        uint8ArrayFromHexString(receiver.publicKey),
      ),
      hpkeInfo: ZEROXKEY_HPKE_INFO,
    });

    const credentialBundle = bs58check.encode(encrypted);
    const decryptedData = decryptCredentialBundle(
      credentialBundle,
      receiver.privateKey,
    );
    expect(decryptedData).toBe(plaintextHex);
  });

  test("extractPrivateKeyFromPKCS8Bytes", () => {
    const pkcs8PrivateKeyHex =
      "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b020101042001d95d256f744b2a855fe2036ec1074c726445f1382f53580a17ce3296cc2deca1440342000440fa0a112351e0f5cdcc3edad914e7e3b911d3e83874d4ef55ff5639f4a3633e65087a8499c46a77f8e68c937203d85e6d38ade95d755a6cf88fa101091d5983";
    const expectedRawPrivateKeyHex =
      "01d95d256f744b2a855fe2036ec1074c726445f1382f53580a17ce3296cc2dec";
    expect(
      extractPrivateKeyFromPKCS8Bytes(
        uint8ArrayFromHexString(pkcs8PrivateKeyHex),
      ),
    ).toEqual(uint8ArrayFromHexString(expectedRawPrivateKeyHex));
  });

  test("verifyRequestStamp", async () => {
    const { publicKey: apiPublicKey, privateKey: apiPrivateKey } =
      generateP256KeyPair();

    // we create a sample request payload
    const requestBody = JSON.stringify({
      organizationId: "00000000-00000000-00000000-00000000",
      timestampMs: Date.now().toString(),
    });

    // we manually create a signature using @noble/curves directly
    // to avoid a circular dependency with ApiKeyStamper
    const messageHash = sha256(new TextEncoder().encode(requestBody));
    const privateKeyBytes = uint8ArrayFromHexString(apiPrivateKey);
    const signatureBytes = p256.sign(messageHash, privateKeyBytes).toDERHex();

    // we verify the signature
    const verified = await verifyStampSignature(
      apiPublicKey,
      signatureBytes,
      requestBody,
    );

    expect(verified).toEqual(true);
  });

  describe("uncompressRawPublicKey", () => {
    test("happy path", async () => {
      const keypair = generateP256KeyPair();
      const uncompressedPublicKey = uncompressRawPublicKey(
        uint8ArrayFromHexString(keypair.publicKey),
      );
      expect(uncompressedPublicKey.length).toEqual(65);
    });

    test("invalid prefix", async () => {
      const invalidPrefix = uint8ArrayFromHexString(
        "77c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
      );

      expect(() => uncompressRawPublicKey(invalidPrefix)).toThrow(
        "failed to uncompress raw public key: invalid prefix",
      );
    });

    test("invalid length", async () => {
      const keypair = generateP256KeyPair();

      expect(() =>
        uncompressRawPublicKey(
          uint8ArrayFromHexString(keypair.publicKey + keypair.publicKey),
        ),
      ).toThrow("failed to uncompress raw public key: invalid length");
    });
  });

  describe("Valid DER signatures", () => {
    test("should parse a simple DER signature with short-form length", () => {
      // Create a signature with 32-byte r and s values
      const rValue = new Array(32).fill(0x01);
      const sValue = new Array(32).fill(0x02);
      const totalLength = 2 + 32 + 2 + 32; // 2 bytes for each INTEGER header + values

      const derHex = createDerSignature([totalLength], rValue, sValue);

      expect(() => fromDerSignature(derHex)).not.toThrow();
    });

    test("should parse a DER signature with 33-byte integers (with leading zero)", () => {
      // ECDSA signatures sometimes have leading zeros to ensure positive integers
      const rValue = [0x00, ...new Array(32).fill(0x80)]; // Leading zero + high bit set
      const sValue = [0x00, ...new Array(32).fill(0x90)];
      const totalLength = 2 + 33 + 2 + 33;

      const derHex = createDerSignature([totalLength], rValue, sValue);

      expect(() => fromDerSignature(derHex)).not.toThrow();
    });
  });

  describe("Invalid signatures - missing SEQUENCE tag", () => {
    test("should reject signatures without SEQUENCE tag (0x30)", () => {
      const invalidHex = bytesToHex([
        0x31, // Wrong tag (should be 0x30)
        0x44, // Length of SEQUENCE
        0x02,
        0x20,
        ...new Array(32).fill(0x01), // r
        0x02,
        0x20,
        ...new Array(32).fill(0x02), // s
      ]);

      expect(() => fromDerSignature(invalidHex)).toThrow(
        "failed to convert DER-encoded signature: invalid format (missing SEQUENCE tag)",
      );
    });

    test("should reject empty signatures", () => {
      expect(() => fromDerSignature("")).toThrow(
        "cannot create uint8array from invalid hex string",
      );
    });

    test("should reject signatures that are too short", () => {
      const shortHex = bytesToHex([0x30]); // Only SEQUENCE tag, no length
      expect(() => fromDerSignature(shortHex)).toThrow(
        "failed to convert DER-encoded signature: insufficient length",
      );
    });
  });

  describe("Invalid signatures - length field issues", () => {
    test("should reject signatures with unsupported length encoding (0x80-0xFE range)", () => {
      const unsupportedLengthHex = bytesToHex([
        0x30, // SEQUENCE tag
        0x81, // Length encoding value that we do not want to support
        0x44, // Length value
        // ... rest of signature would follow
      ]);

      expect(() => fromDerSignature(unsupportedLengthHex)).toThrow(
        /large or invalid signature length/,
      );
    });

    test("should handle edge case of maximum short-form length (0x7F)", () => {
      // This would be a very large signature chunk with trailing data, but valid short-form
      const rValue = new Array(32).fill(0x01);
      const sValue = new Array(32).fill(0x02);

      const derHex = bytesToHex([
        0x30, // SEQUENCE tag
        0x7f, // Maximum short-form length of SEQUENCE
        0x02, // INTEGER tag
        0x20, // length of INTEGER
        ...rValue, // r (34 bytes total for INTEGER including header)
        0x02, // INTEGER tag
        0x20, // length of INTEGER
        ...sValue, // s (34 bytes total for INTEGER including header)
        ...new Array(0x7f - 68).fill(0x00), // Padding to reach 0x7F total length
      ]);

      expect(() => fromDerSignature(derHex)).not.toThrow();
    });

    test("should reject signatures with invalid r length", () => {
      const invalidRTagHex = bytesToHex([
        0x30, // SEQUENCE tag
        0x44, // length of SEQUENCE
        0x02, // Correct tag for r
        0x22, // length of INTEGER // invalid -- should be 32 or 33
        ...new Array(34).fill(0x01), // r
        0x02, // Correct tag for s
        0x20, // length of INTEGER
        ...new Array(32).fill(0x02), // s
      ]);

      expect(() => fromDerSignature(invalidRTagHex)).toThrow(
        /unexpected length for r/,
      );
    });

    test("should reject signatures with invalid s length", () => {
      const invalidRTagHex = bytesToHex([
        0x30, // SEQUENCE tag
        0x44, // length of SEQUENCE
        0x02, // Correct tag for r
        0x20, // length of INTEGER
        ...new Array(32).fill(0x01), // r
        0x02, // Correct tag for s
        0x22, // length of INTEGER // invalid -- should be 32 or 33
        ...new Array(34).fill(0x02), // s
      ]);

      expect(() => fromDerSignature(invalidRTagHex)).toThrow(
        /unexpected length for s/,
      );
    });

    test("should reject signatures with invalid, non-padding r bytes", () => {
      const invalidRTagHex = bytesToHex([
        0x30, // SEQUENCE tag
        0x44, // length of SEQUENCE
        0x02, // Correct tag for r
        0x21, // length of INTEGER // 33 -- this is valid
        ...new Array(33).fill(0x01), // r -- this is invalid, as the first byte in a 33 byte sequence is a non-padding byte
        0x02, // Correct tag for s
        0x20, // length of INTEGER
        ...new Array(32).fill(0x02), // s
      ]);

      expect(() => fromDerSignature(invalidRTagHex)).toThrow(
        /invalid number of starting zeroes/,
      );
    });

    test("should reject signatures with invalid, non-padding s bytes", () => {
      const invalidRTagHex = bytesToHex([
        0x30, // SEQUENCE tag
        0x44, // length of SEQUENCE
        0x02, // Correct tag for r
        0x20, // length of INTEGER
        ...new Array(32).fill(0x01), // r
        0x02, // Correct tag for s
        0x21, // length of INTEGER // 33 -- this is valid
        ...new Array(33).fill(0x02), // s -- this is invalid, as the first byte in a 33 byte sequence is a non-padding byte
      ]);

      expect(() => fromDerSignature(invalidRTagHex)).toThrow(
        /invalid number of starting zeroes/,
      );
    });
  });

  describe("Invalid signatures - INTEGER parsing", () => {
    test("should reject signatures with invalid r INTEGER tag", () => {
      const invalidRTagHex = bytesToHex([
        0x30, // SEQUENCE tag
        0x44, // length of SEQUENCE
        0x03, // WRONG tag for r (0x03 instead of 0x02)
        0x20, // length of INTEGER
        ...new Array(32).fill(0x01), // r
        0x02, // Correct tag for s
        0x20, // length of INTEGER
        ...new Array(32).fill(0x02), // s
      ]);

      expect(() => fromDerSignature(invalidRTagHex)).toThrow(
        /invalid tag for r/,
      );
    });

    test("should reject signatures with invalid s INTEGER tag", () => {
      const invalidSTagHex = bytesToHex([
        0x30, // SEQUENCE tag
        0x44, // length of SEQUENCE
        0x02, // Correct tag for r
        0x20, // length of INTEGER
        ...new Array(32).fill(0x01), // r
        0x03, // WRONG tag for s (0x03 instead of 0x02)
        0x20, // length of INTEGER
        ...new Array(32).fill(0x02), // s
      ]);

      expect(() => fromDerSignature(invalidSTagHex)).toThrow(
        /invalid tag for s/,
      );
    });
  });
});

describe("Session JWT signature", () => {
  test("verifies the provided JWT against its public key", async () => {
    const jwt =
      "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9." +
      "eyJleHAiOjE3NDg4NzY4MzcsInB1YmxpY19rZXkiOiIwMzk5ZmUyYWNlNjIwOGFmMGFkZjg0OGY0NGJjNDgyMTBiNTk0YjdlNjllY2Q5MWVjOTY4ZmQ3NWIzYmI0NDgzMzYiLCJzZXNzaW9uX3R5cGUiOiJTRVNTSU9OX1RZUEVfUkVBRF9XUklURSIsInVzZXJfaWQiOiI2OTEyYjgxOS1mNGRmLTQwZjQtYTE5Mi0yMGVlNDMwOTA5NzQiLCJvcmdhbml6YXRpb25faWQiOiJjNzVlY2IwNy1jODRhLTRkZDUtOTMyYy01MzlkZmFmYzY4NjQifQ." +
      "y6LPW1jlTwc9jFcvCwKJoKfleL_vHnGUr5tRVdMFUCnHvDspSPZ3DWK85tf1znCCBFQ6MYaFOl-1FLb0KcFxqQ";

    const ok = await verifySessionJwtSignature(jwt);
    expect(ok).toBe(true);
  });
});

// Helper function to create hex strings from byte arrays
const bytesToHex = (bytes: number[]): string => {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
};

// Helper function to create a basic DER signature structure
const createDerSignature = (
  sequenceLength: number[],
  rValue: number[],
  sValue: number[],
): string => {
  const rLength = rValue.length;
  const sLength = sValue.length;

  return bytesToHex([
    0x30, // SEQUENCE tag
    ...sequenceLength, // Sequence length (can be multiple bytes)
    0x02, // INTEGER tag for r
    rLength, // r length (assuming single byte for simplicity)
    ...rValue,
    0x02, // INTEGER tag for s
    sLength, // s length (assuming single byte for simplicity)
    ...sValue,
  ]);
};
