import { describe, expect, test } from "@jest/globals";
import { createECDH, createHash, ECDH } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import * as cryptoExports from "../index";
import { encryptOnRampSecret } from "../index";

// SHA-256 of the lowercase compressed hex of the upstream Turnkey production
// on-ramp encryption key. Only the fingerprint is kept so this file does not
// match itself.
const UPSTREAM_ON_RAMP_FINGERPRINT =
  "b62c713b4224eeccde946007642cd1a7787a9d0916aa7dc53b53bd9edf7228c6";

const REPOSITORY_ROOT = resolve(__dirname, "../../../..");
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".turbo",
  ".next",
  "node_modules",
  "dist",
  "coverage",
]);
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|json|md|mdx|ya?ml|kt|swift|txt)$/;

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) yield* sourceFiles(path);
    else if (TEXT_FILE.test(entry) && stats.size < 5_000_000) yield path;
  }
}

function compressedKeys(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(/0[23][0-9a-fA-F]{64}/g)) {
    keys.push(match[0].toLowerCase());
  }
  for (const match of text.matchAll(/04[0-9a-fA-F]{128}/g)) {
    try {
      const compressed = ECDH.convertKey(
        match[0],
        "prime256v1",
        "hex",
        "hex",
        "compressed",
      ) as string;
      keys.push(compressed.toLowerCase());
    } catch {
      // Not a P-256 point.
    }
  }
  return keys;
}

function fingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

describe("encryptOnRampSecret", () => {
  test("requires an explicit encryption public key", () => {
    expect(() =>
      (encryptOnRampSecret as (secret: string) => string)("provider-secret"),
    ).toThrow(/on-ramp encryption public key is required/i);
    expect(() => encryptOnRampSecret("provider-secret", "")).toThrow(
      /on-ramp encryption public key is required/i,
    );
  });

  test("encrypts to the key it is given", () => {
    const target = createECDH("prime256v1");
    target.setPrivateKey(Buffer.alloc(32, 9));
    const envelope = encryptOnRampSecret(
      "provider-secret",
      target.getPublicKey("hex", "compressed"),
    );
    expect(typeof envelope).toBe("string");
    expect(envelope.length).toBeGreaterThan(0);
  });

  test("no longer exports an upstream production key constant", () => {
    expect(
      "PRODUCTION_ON_RAMP_CREDENTIALS_ENCRYPTION_PUBLIC_KEY" in cryptoExports,
    ).toBe(false);
  });
});

test("the upstream Turnkey production on-ramp key appears nowhere in the repository", () => {
  const hits: string[] = [];
  for (const file of sourceFiles(REPOSITORY_ROOT)) {
    const text = readFileSync(file, "utf8");
    if (
      compressedKeys(text).some(
        (key) => fingerprint(key) === UPSTREAM_ON_RAMP_FINGERPRINT,
      )
    ) {
      hits.push(relative(REPOSITORY_ROOT, file));
    }
  }
  expect(hits).toEqual([]);
});
