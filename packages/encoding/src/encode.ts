import { pointEncode as pointEncodeImpl } from "@0xkey-io/internal-codec";

export function pointEncode(raw: Uint8Array): Uint8Array {
  return pointEncodeImpl(raw);
}
