import {
  AES_KEY_INFO as AES_KEY_INFO_IMPL,
  AWS_ROOT_CERT_PEM as AWS_ROOT_CERT_PEM_IMPL,
  AWS_ROOT_CERT_SHA256 as AWS_ROOT_CERT_SHA256_IMPL,
  HPKE_VERSION as HPKE_VERSION_IMPL,
  IV_INFO as IV_INFO_IMPL,
  LABEL_EAE_PRK as LABEL_EAE_PRK_IMPL,
  LABEL_SECRET as LABEL_SECRET_IMPL,
  LABEL_SHARED_SECRET as LABEL_SHARED_SECRET_IMPL,
  PRODUCTION_NOTARIZER_SIGN_PUBLIC_KEY as PRODUCTION_NOTARIZER_SIGN_PUBLIC_KEY_IMPL,
  PRODUCTION_ON_RAMP_CREDENTIALS_ENCRYPTION_PUBLIC_KEY as PRODUCTION_ON_RAMP_CREDENTIALS_ENCRYPTION_PUBLIC_KEY_IMPL,
  PRODUCTION_QUORUM_KEY_HEX as PRODUCTION_QUORUM_KEY_HEX_IMPL,
  PRODUCTION_QUORUM_MANIFEST_SET_MEMBERS as PRODUCTION_QUORUM_MANIFEST_SET_MEMBERS_IMPL,
  PRODUCTION_QUORUM_MANIFEST_SET_THRESHOLD as PRODUCTION_QUORUM_MANIFEST_SET_THRESHOLD_IMPL,
  PRODUCTION_SIGNER_SIGN_PUBLIC_KEY as PRODUCTION_SIGNER_SIGN_PUBLIC_KEY_IMPL,
  PRODUCTION_TLS_FETCHER_ENCRYPT_PUBLIC_KEY as PRODUCTION_TLS_FETCHER_ENCRYPT_PUBLIC_KEY_IMPL,
  QOS_ENCRYPTION_HMAC_MESSAGE as QOS_ENCRYPTION_HMAC_MESSAGE_IMPL,
  QUORUM_ENCRYPT_NONCE_LENGTH_BYTES as QUORUM_ENCRYPT_NONCE_LENGTH_BYTES_IMPL,
  STAGING_QUORUM_KEY_HEX as STAGING_QUORUM_KEY_HEX_IMPL,
  STAGING_QUORUM_MANIFEST_SET_MEMBERS as STAGING_QUORUM_MANIFEST_SET_MEMBERS_IMPL,
  STAGING_QUORUM_MANIFEST_SET_THRESHOLD as STAGING_QUORUM_MANIFEST_SET_THRESHOLD_IMPL,
  SUITE_ID_1 as SUITE_ID_1_IMPL,
  SUITE_ID_2 as SUITE_ID_2_IMPL,
  UNCOMPRESSED_PUB_KEY_LENGTH_BYTES as UNCOMPRESSED_PUB_KEY_LENGTH_BYTES_IMPL,
  buildAdditionalAssociatedData as buildAdditionalAssociatedDataImpl,
  compressRawPublicKey as compressRawPublicKeyImpl,
  extractPrivateKeyFromPKCS8Bytes as extractPrivateKeyFromPKCS8BytesImpl,
  formatHpkeBuf as formatHpkeBufImpl,
  fromDerSignature as fromDerSignatureImpl,
  generateP256KeyPair as generateP256KeyPairImpl,
  getPublicKey as getPublicKeyImpl,
  hpkeAuthEncrypt as hpkeAuthEncryptImpl,
  hpkeDecrypt as hpkeDecryptImpl,
  hpkeEncrypt as hpkeEncryptImpl,
  modSqrt as modSqrtImpl,
  quorumKeyEncrypt as quorumKeyEncryptImpl,
  testBit as testBitImpl,
  toDerSignature as toDerSignatureImpl,
  uncompressRawPublicKey as uncompressRawPublicKeyImpl,
} from "@0xkey-io/internal-crypto-core";

export type HpkeDecryptParams = {
  ciphertextBuf: Uint8Array;
  encappedKeyBuf: Uint8Array;
  receiverPriv: string;
  hpkeInfo?: string;
};

export type HpkeEncryptParams = {
  plainTextBuf: Uint8Array;
  targetKeyBuf: Uint8Array;
  hpkeInfo?: string;
};

export type HpkeAuthEncryptParams = {
  plainTextBuf: Uint8Array;
  targetKeyBuf: Uint8Array;
  senderPriv: string;
  hpkeInfo?: string;
};

export type KeyPair = {
  privateKey: string;
  publicKey: string;
  publicKeyUncompressed: string;
};

export function getPublicKey(
  privateKey: Uint8Array | string,
  isCompressed?: boolean,
): Uint8Array {
  return getPublicKeyImpl(privateKey, isCompressed);
}

export function hpkeEncrypt(params: HpkeEncryptParams): Uint8Array {
  return hpkeEncryptImpl(params);
}

export function hpkeAuthEncrypt(params: HpkeAuthEncryptParams): Uint8Array {
  return hpkeAuthEncryptImpl(params);
}

export async function quorumKeyEncrypt(
  targetPublicKeyUncompressed: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  return quorumKeyEncryptImpl(targetPublicKeyUncompressed, message);
}

export function formatHpkeBuf(encryptedBuf: Uint8Array): string {
  return formatHpkeBufImpl(encryptedBuf);
}

export function hpkeDecrypt(params: HpkeDecryptParams): Uint8Array {
  return hpkeDecryptImpl(params);
}

export function generateP256KeyPair(): KeyPair {
  return generateP256KeyPairImpl();
}

export function buildAdditionalAssociatedData(
  senderPubBuf: Uint8Array,
  receiverPubBuf: Uint8Array,
): Uint8Array {
  return buildAdditionalAssociatedDataImpl(senderPubBuf, receiverPubBuf);
}

export function extractPrivateKeyFromPKCS8Bytes(
  privateKey: Uint8Array,
): Uint8Array {
  return extractPrivateKeyFromPKCS8BytesImpl(privateKey);
}

export function compressRawPublicKey(rawPublicKey: Uint8Array): Uint8Array {
  return compressRawPublicKeyImpl(rawPublicKey);
}

export function uncompressRawPublicKey(
  rawPublicKey: Uint8Array,
  curve?: "CURVE_SECP256K1" | "CURVE_P256",
): Uint8Array {
  return uncompressRawPublicKeyImpl(rawPublicKey, curve);
}

export function fromDerSignature(derSignature: string): Uint8Array {
  return fromDerSignatureImpl(derSignature);
}

export function toDerSignature(rawSignature: string): string {
  return toDerSignatureImpl(rawSignature);
}

export function modSqrt(x: bigint, p: bigint): bigint {
  return modSqrtImpl(x, p);
}

export function testBit(n: bigint, i: number): boolean {
  return testBitImpl(n, i);
}

export const SUITE_ID_1 = SUITE_ID_1_IMPL;
export const SUITE_ID_2 = SUITE_ID_2_IMPL;
export const HPKE_VERSION = HPKE_VERSION_IMPL;
export const LABEL_SECRET = LABEL_SECRET_IMPL;
export const LABEL_EAE_PRK = LABEL_EAE_PRK_IMPL;
export const LABEL_SHARED_SECRET = LABEL_SHARED_SECRET_IMPL;
export const AES_KEY_INFO = AES_KEY_INFO_IMPL;
export const IV_INFO = IV_INFO_IMPL;
export const QUORUM_ENCRYPT_NONCE_LENGTH_BYTES =
  QUORUM_ENCRYPT_NONCE_LENGTH_BYTES_IMPL;
export const UNCOMPRESSED_PUB_KEY_LENGTH_BYTES =
  UNCOMPRESSED_PUB_KEY_LENGTH_BYTES_IMPL;
export const QOS_ENCRYPTION_HMAC_MESSAGE = QOS_ENCRYPTION_HMAC_MESSAGE_IMPL;
export const PRODUCTION_SIGNER_SIGN_PUBLIC_KEY =
  PRODUCTION_SIGNER_SIGN_PUBLIC_KEY_IMPL;
export const PRODUCTION_NOTARIZER_SIGN_PUBLIC_KEY =
  PRODUCTION_NOTARIZER_SIGN_PUBLIC_KEY_IMPL;
export const PRODUCTION_TLS_FETCHER_ENCRYPT_PUBLIC_KEY =
  PRODUCTION_TLS_FETCHER_ENCRYPT_PUBLIC_KEY_IMPL;
export const PRODUCTION_ON_RAMP_CREDENTIALS_ENCRYPTION_PUBLIC_KEY =
  PRODUCTION_ON_RAMP_CREDENTIALS_ENCRYPTION_PUBLIC_KEY_IMPL;
export const AWS_ROOT_CERT_PEM = AWS_ROOT_CERT_PEM_IMPL;
export const AWS_ROOT_CERT_SHA256 = AWS_ROOT_CERT_SHA256_IMPL;
export const PRODUCTION_QUORUM_MANIFEST_SET_THRESHOLD =
  PRODUCTION_QUORUM_MANIFEST_SET_THRESHOLD_IMPL;
export const PRODUCTION_QUORUM_MANIFEST_SET_MEMBERS =
  PRODUCTION_QUORUM_MANIFEST_SET_MEMBERS_IMPL;
export const PRODUCTION_QUORUM_KEY_HEX = PRODUCTION_QUORUM_KEY_HEX_IMPL;
export const STAGING_QUORUM_MANIFEST_SET_THRESHOLD =
  STAGING_QUORUM_MANIFEST_SET_THRESHOLD_IMPL;
export const STAGING_QUORUM_MANIFEST_SET_MEMBERS =
  STAGING_QUORUM_MANIFEST_SET_MEMBERS_IMPL;
export const STAGING_QUORUM_KEY_HEX = STAGING_QUORUM_KEY_HEX_IMPL;
