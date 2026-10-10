import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { stringToBase64urlString } from "@0xkey-io/encoding";
import {
  canonicalizeNativeBinding,
  nativeOAuthError,
  type NativeBinding,
} from "../utils/oauth-native-store";

export type NativeAuthenticateInput = Readonly<{
  publicKey: string;
  expectedNonce: string;
}>;

export type PrivateNativeAdapter = Readonly<{
  binding: NativeBinding;
  authenticate(input: NativeAuthenticateInput): Promise<{ oidcToken: string }>;
}>;

export type NativeEntropy = (length: number) => Uint8Array;

const PUBLIC_KEY = /^(?:0[23][0-9a-f]{64}|04[0-9a-f]{128})$/;
const NONCE = /^[0-9a-f]{64}$/;

export function checkedBinding(
  input: NativeBinding,
  provider: NativeBinding["provider"],
  platform: NativeBinding["platform"],
): NativeBinding {
  const binding = canonicalizeNativeBinding(input);
  if (binding.provider !== provider || binding.platform !== platform)
    throw nativeOAuthError("config-invalid");
  return binding;
}

export function checkedNonce(input: NativeAuthenticateInput): string {
  if (
    !input ||
    typeof input.publicKey !== "string" ||
    !PUBLIC_KEY.test(input.publicKey) ||
    typeof input.expectedNonce !== "string" ||
    !NONCE.test(input.expectedNonce) ||
    bytesToHex(sha256(input.publicKey)) !== input.expectedNonce
  ) {
    throw nativeOAuthError("config-invalid");
  }
  return input.expectedNonce;
}

export function checkedEntropy(source: NativeEntropy, length: 16 | 32): string {
  try {
    if (typeof source !== "function")
      throw nativeOAuthError("randomness-unavailable");
    const bytes = source(length);
    if (!(bytes instanceof Uint8Array) || bytes.length !== length)
      throw nativeOAuthError("randomness-unavailable");
    return stringToBase64urlString(
      String.fromCharCode(...new Uint8Array(bytes)),
    );
  } catch {
    throw nativeOAuthError("randomness-unavailable");
  }
}

export function checkedToken(value: unknown): { oidcToken: string } {
  if (typeof value !== "string" || !value || value.trim() !== value)
    throw nativeOAuthError("result-invalid");
  return { oidcToken: value };
}

export function checkedState(value: unknown, expected: string): void {
  if (typeof value !== "string" || value !== expected)
    throw nativeOAuthError("result-invalid");
}
