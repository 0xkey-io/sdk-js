import {
  hexToAscii as hexToAsciiImpl,
  normalizePadding as normalizePaddingImpl,
  uint8ArrayFromHexString as uint8ArrayFromHexStringImpl,
  uint8ArrayToHexString as uint8ArrayToHexStringImpl,
} from "@0xkey-io/internal-codec";

/**
 * Converts a Uint8Array into a lowercase hex string.
 */
export function uint8ArrayToHexString(input: Uint8Array): string {
  return uint8ArrayToHexStringImpl(input);
}

/**
 * Creates a Uint8Array from a hex string.
 */
export function uint8ArrayFromHexString(
  hexString: string,
  length?: number,
): Uint8Array {
  return uint8ArrayFromHexStringImpl(hexString, length);
}

/**
 * Converts a hex string to an ASCII string.
 */
export function hexToAscii(hexString: string): string {
  return hexToAsciiImpl(hexString);
}

/**
 * Function to normalize padding of byte array with 0's to a target length.
 */
export function normalizePadding(
  byteArray: Uint8Array,
  targetLength: number,
): Uint8Array {
  return normalizePaddingImpl(byteArray, targetLength);
}
