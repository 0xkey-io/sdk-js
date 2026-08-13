# @0xkey-io/crypto

The Commerce Boot adapter verifies the real qOS/Nitro Boot/AppProof chain and
never promotes a non-Commerce profile. Its deterministic package-private test
covers session signature, canonical `commerce-authorization/v1`, claims-hash,
and WeakSet projection semantics. The first real combined Commerce staging
artifact remains the AC-M1-OX-008 hard integration gate.

This package consolidates some common cryptographic utilities used across our applications, particularly primitives related to keys, encryption, and decryption in a pure JS implementation. For react-native you will need to polyfill our random byte generation by importing [react-native-get-random-values](https://www.npmjs.com/package/react-native-get-random-values)

Example usage (Hpke E2E):

```
const senderKeyPair = generateP256KeyPair();
const receiverKeyPair = generateP256KeyPair();

const receiverPublicKeyUncompressed = uncompressRawPublicKey(
  uint8ArrayFromHexString(receiverKeyPair.publicKey),
);

const plainText = "Hello, this is a secure message!";
const plainTextBuf = textEncoder.encode(plainText);
const encryptedData = hpkeEncrypt({
  plainTextBuf: plainTextBuf,
  encappedKeyBuf: receiverPublicKeyUncompressed,
  senderPriv: senderKeyPair.privateKey,
});

// Extract the encapsulated key buffer and the ciphertext
const encappedKeyBuf = encryptedData.slice(0, 33);
const ciphertextBuf = encryptedData.slice(33);

const decryptedData = hpkeDecrypt({
  ciphertextBuf,
  encappedKeyBuf: uncompressRawPublicKey(encappedKeyBuf),
  receiverPriv: receiverKeyPair.privateKey,
});

// Convert decrypted data back to string
const decryptedText = new TextDecoder().decode(decryptedData);
```
