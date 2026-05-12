import {
  fromDerSignature,
  generateP256KeyPair,
  hpkeEncrypt,
  toDerSignature,
} from "../../../../packages/crypto/dist/index";

async function demo() {
  const keyPair = generateP256KeyPair();
  const plaintext = new Uint8Array([1, 2, 3]);
  const publicKey = new Uint8Array(65);
  publicKey[0] = 4;

  const ciphertext: Uint8Array = hpkeEncrypt({
    plainTextBuf: plaintext,
    targetKeyBuf: publicKey,
  });

  const der: string = toDerSignature("00".repeat(128));
  const raw: Uint8Array = fromDerSignature(der);

  return { keyPair, ciphertext, raw };
}

export { demo };
