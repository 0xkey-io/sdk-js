import {
  atob as atobImpl,
  base64StringToBase64UrlEncodedString as base64StringToBase64UrlEncodedStringImpl,
  base64UrlToBase64 as base64UrlToBase64Impl,
  decodeBase64urlToString as decodeBase64urlToStringImpl,
  hexStringToBase64url as hexStringToBase64urlImpl,
  stringToBase64urlString as stringToBase64urlStringImpl,
} from "@0xkey-io/internal-codec";

export function stringToBase64urlString(input: string): string {
  return stringToBase64urlStringImpl(input);
}

export function hexStringToBase64url(input: string, length?: number): string {
  return hexStringToBase64urlImpl(input, length);
}

export function base64StringToBase64UrlEncodedString(input: string): string {
  return base64StringToBase64UrlEncodedStringImpl(input);
}

export function base64UrlToBase64(input: string): string {
  return base64UrlToBase64Impl(input);
}

export function decodeBase64urlToString(input: string): string {
  return decodeBase64urlToStringImpl(input);
}

export function atob(input: string): string {
  return atobImpl(input);
}
