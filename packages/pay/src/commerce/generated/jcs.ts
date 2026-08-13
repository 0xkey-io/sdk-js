import { sha256 } from "viem";

import { CommerceCodecError } from "./codec-error";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function invalid(): never {
  throw new CommerceCodecError("SCHEMA_INVALID");
}

function validateUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (!(following >= 0xdc00 && following <= 0xdfff)) invalid();
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid();
    }
  }
}

function validateIJson(
  value: unknown,
  ancestors: Set<object>,
): asserts value is JsonValue {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    validateUnicode(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return;
  }
  if (typeof value !== "object" || ancestors.has(value)) invalid();
  ancestors.add(value);

  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      invalid();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).filter((key) => key !== "length");
    if (
      keys.length !== value.length ||
      keys.some((key, index) => key !== String(index))
    )
      invalid();
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[index];
      if (!descriptor?.enumerable || !("value" in descriptor)) invalid();
      validateIJson(descriptor.value, ancestors);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    if (Object.getOwnPropertySymbols(value).length > 0) invalid();
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      validateUnicode(key);
      if (!descriptor.enumerable || !("value" in descriptor)) invalid();
      validateIJson(descriptor.value, ancestors);
    }
  }
  ancestors.delete(value);
}

function canonicalText(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalText).join(",")}]`;
  const object = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalText(object[key]!)}`)
    .join(",")}}`;
}

export function canonicalizeJcs(value: unknown): Uint8Array {
  assertIJson(value);
  return new TextEncoder().encode(canonicalText(value));
}

export function assertIJson(value: unknown): asserts value is JsonValue {
  validateIJson(value, new Set());
}

export function digestJcs(value: unknown): `sha256:${string}` {
  return sha256Bytes(canonicalizeJcs(value));
}

export function sha256Bytes(value: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256(value).slice(2)}`;
}
