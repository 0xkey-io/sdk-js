import {
  DEFAULT_JWK_MEMBER_BYTE_LENGTH,
  hexStringToBase64url,
  stringToBase64urlString,
  uint8ArrayFromHexString,
  uint8ArrayToHexString,
} from "../../../../packages/encoding/dist/index";

const hex: string = uint8ArrayToHexString(new Uint8Array([1, 2, 3]));
const bytes: Uint8Array = uint8ArrayFromHexString("010203");
const b64: string = stringToBase64urlString("hello");
const b64FromHex: string = hexStringToBase64url("0102");
const defaultLen: number = DEFAULT_JWK_MEMBER_BYTE_LENGTH;

export { hex, bytes, b64, b64FromHex, defaultLen };
