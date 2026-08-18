export function corruptBase64urlBytes(ciphertext: string): string {
  const bytes = Buffer.from(ciphertext, "base64url");
  if (bytes.length === 0) {
    throw new Error("Ciphertext must contain at least one byte");
  }
  bytes[0] = bytes[0]! ^ 0x01;
  return bytes.toString("base64url");
}
