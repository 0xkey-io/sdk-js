import { readFileSync } from "node:fs";
import path from "node:path";

import {
  COMMERCE_CONTRACT_METADATA,
  CommerceCodecError,
  type CommerceBundleManifest,
  type CommerceCodecCorpus,
  commerceContract,
} from "./codec";

const corpus = JSON.parse(
  readFileSync(path.join(__dirname, "rc-bundle", "codec-corpus.json"), "utf8"),
) as CommerceCodecCorpus;
const manifest = JSON.parse(
  readFileSync(
    path.join(__dirname, "rc-bundle", "bundle-manifest.json"),
    "utf8",
  ),
) as CommerceBundleManifest;
const manifestText = readFileSync(
  path.join(__dirname, "rc-bundle", "bundle-manifest.json"),
  "utf8",
);

describe("accepted Commerce contract metadata and negotiation", () => {
  it("exposes the immutable draft.4 RC coordinates", () => {
    expect(COMMERCE_CONTRACT_METADATA).toEqual({
      protocolVersion: "0.1.0-draft.4",
      wireVersion: "0.1",
      sourceDigest:
        "sha256:0069b449f4b0f2f2ae88103219a182703498231b3e7cbe6d76cdd7e3f195ff27",
      generatorVersion: "0.1.0",
      generatorHash:
        "sha256:8f6d309f509e095b1bbca3c011c0ca046dbbdacb075e84e0b13091581a2a07fa",
      bundleDigest:
        "sha256:61daab4e29396dad5c393a6d0838963106b526849f7e880fa30538ea81cf83f6",
    });
  });

  it("selects only the supported 0.1 wire version", () => {
    expect(commerceContract.negotiate(["0.2", "0.1"])).toBe("0.1");
    expect(() => commerceContract.negotiate(["0.2", "0.1.0-draft.4"])).toThrow(
      new CommerceCodecError("UNSUPPORTED_PROTOCOL_VERSION"),
    );
  });
});

describe("canonical encoding and shared ordered corpus", () => {
  it("matches the independent canonical SHA-256 literals", () => {
    for (const fixture of corpus.cases.filter(
      ({ expected }) => expected.canonicalSha256 !== null,
    )) {
      expect(commerceContract.digest(fixture.input)).toBe(
        fixture.expected.canonicalSha256,
      );
    }
  });

  it("emits the exact ordered, metadata-only report encoding", () => {
    const records = commerceContract.runCorpus(corpus);
    expect(records).toEqual(
      corpus.cases.map(({ id, expected }) => ({
        id,
        canonicalSha256: expected.canonicalSha256,
        errorCode: expected.errorCode,
      })),
    );
    expect(
      records.every(
        (record) =>
          JSON.stringify(Object.keys(record)) ===
          JSON.stringify(["id", "canonicalSha256", "errorCode"]),
      ),
    ).toBe(true);
    expect(commerceContract.formatReport(records)).toBe(
      `${JSON.stringify(records)}\n`,
    );
    expect(commerceContract.formatReport(records)).not.toMatch(
      /objectType|signature|input/,
    );
  });
});

describe("offline immutable RC bundle verification", () => {
  const bundleRoot = path.join(__dirname, "rc-bundle");
  const files = Object.fromEntries(
    manifest.files.map(({ path: relativePath }) => [
      relativePath,
      new Uint8Array(readFileSync(path.join(bundleRoot, relativePath))),
    ]),
  );

  it("verifies every raw file and the non-recursive manifest frame", () => {
    expect(commerceContract.verifyBundle(manifestText, files)).toBe(
      COMMERCE_CONTRACT_METADATA,
    );
    expect(
      commerceContract.verifyBundle(
        new TextEncoder().encode(manifestText),
        files,
      ),
    ).toBe(COMMERCE_CONTRACT_METADATA);
  });

  it("fails closed on file mutation, missing/extra files, or a changed bundle digest", () => {
    const firstPath = manifest.files[0]!.path;
    const mutated = { ...files, [firstPath]: files[firstPath]!.slice() };
    mutated[firstPath]![0] ^= 1;
    const missing = { ...files };
    delete missing[firstPath];

    for (const [candidateManifest, candidateFiles] of [
      [manifest, mutated],
      [manifest, missing],
      [manifest, { ...files, "unexpected.json": Uint8Array.of(1) }],
      [{ ...manifest, bundleDigest: "sha256:" + "0".repeat(64) }, files],
    ] as const) {
      expect(() =>
        commerceContract.verifyBundle(candidateManifest, candidateFiles),
      ).toThrow(new CommerceCodecError("CONTRACT_DIGEST_MISMATCH"));
    }
  });

  it("strictly rejects duplicate manifest fields before non-recursive verification", () => {
    const zeroDigest = `sha256:${"0".repeat(64)}`;
    for (const rawManifest of [
      manifestText.replace(
        '  "bundleDigest":',
        `  "bundleDigest": "${zeroDigest}",\n  "bundleDigest":`,
      ),
      manifestText.replace('  "files": [', '  "files": [],\n  "files": ['),
      manifestText.replace(
        '      "path":',
        '      "path": "attacker.json",\n      "path":',
      ),
    ]) {
      expect(() => commerceContract.verifyBundle(rawManifest, files)).toThrow(
        new CommerceCodecError("CONTRACT_DIGEST_MISMATCH"),
      );
    }
  });

  it("returns the stable mismatch error for malformed manifests and unsafe file maps", () => {
    const malformedManifest = manifestText.replace(
      '  "files": [',
      '  "files": [null,',
    );
    expect(() =>
      commerceContract.verifyBundle(malformedManifest, files),
    ).toThrow(new CommerceCodecError("CONTRACT_DIGEST_MISMATCH"));

    const accessorFiles = Object.create(null) as Record<string, Uint8Array>;
    let getterCalled = false;
    for (const [filePath, bytes] of Object.entries(files)) {
      Object.defineProperty(
        accessorFiles,
        filePath,
        filePath === manifest.files[0]!.path
          ? {
              enumerable: true,
              get() {
                getterCalled = true;
                return bytes;
              },
            }
          : { enumerable: true, value: bytes },
      );
    }
    expect(() =>
      commerceContract.verifyBundle(manifest, accessorFiles),
    ).toThrow(new CommerceCodecError("CONTRACT_DIGEST_MISMATCH"));
    expect(getterCalled).toBe(false);
    expect(() =>
      commerceContract.verifyBundle(manifest, null as never),
    ).toThrow(new CommerceCodecError("CONTRACT_DIGEST_MISMATCH"));
  });
});

describe("schema-first Commerce decode", () => {
  it("accepts a published envelope without mutating it", () => {
    const fixture = corpus.cases.find(
      ({ id }) => id === "CODEC.VALID.PAYMENT_FLOW.003",
    );
    expect(fixture).toBeDefined();
    const before = JSON.stringify(fixture!.input);

    expect(commerceContract.decode(fixture!.input)).toEqual(fixture!.input);
    expect(JSON.stringify(fixture!.input)).toBe(before);
  });

  it.each(corpus.cases.filter(({ expected }) => expected.errorCode !== null))(
    "rejects $id with its stable codec error",
    (fixture) => {
      const input = Object.hasOwn(fixture, "inputJson")
        ? fixture.inputJson
        : fixture.input;
      expect(() => commerceContract.decode(input)).toThrow(
        new CommerceCodecError(
          fixture.expected.errorCode as
            | "SCHEMA_INVALID"
            | "UNSUPPORTED_PROTOCOL_VERSION",
        ),
      );
    },
  );

  it("strictly decodes JSON text and rejects top-level or nested duplicate keys", () => {
    const fixture = corpus.cases.find(
      ({ id }) => id === "CODEC.VALID.DOMAIN_OBJECTS.001",
    )!;
    expect(commerceContract.decode(JSON.stringify(fixture.input))).toEqual(
      fixture.input,
    );
    expect(
      commerceContract.decode(
        new TextEncoder().encode(JSON.stringify(fixture.input)),
      ),
    ).toEqual(fixture.input);

    for (const input of [
      '{"objectType":"Unknown","objectType":"ServiceDefinitionVersion","protocolVersion":"0.1"}',
      '{"objectType":"Unknown","protocolVersion":"0.1","nested":{"key":1,"key":2}}',
    ]) {
      expect(() => commerceContract.decode(input)).toThrow(
        new CommerceCodecError("SCHEMA_INVALID"),
      );
    }

    expect(() => commerceContract.decode(Uint8Array.of(0xc3, 0x28))).toThrow(
      new CommerceCodecError("SCHEMA_INVALID"),
    );

    const nonJsonWhitespace = JSON.stringify(fixture.input).replace(
      '":',
      '"\u00a0:',
    );
    expect(() => commerceContract.decode(nonJsonWhitespace)).toThrow(
      new CommerceCodecError("SCHEMA_INVALID"),
    );

    const loneSurrogate = {
      ...(fixture.input as Record<string, unknown>),
      inputSchema: { unconstrained: "\ud800" },
    };
    expect(() =>
      commerceContract.decode(JSON.stringify(loneSurrogate)),
    ).toThrow(new CommerceCodecError("SCHEMA_INVALID"));
  });

  it("enforces uint256 and RFC3339 formats registered by the accepted schema", () => {
    const offer = structuredClone(
      corpus.cases.find(({ id }) => id === "CODEC.VALID.DOMAIN_OBJECTS.002")!
        .input,
    ) as Record<string, unknown>;
    const listing = structuredClone(
      corpus.cases.find(({ id }) => id === "CODEC.VALID.DOMAIN_OBJECTS.005")!
        .input,
    ) as Record<string, unknown>;

    for (const amountAtomic of ["0", (1n << 256n).toString()]) {
      expect(() => commerceContract.decode({ ...offer, amountAtomic })).toThrow(
        new CommerceCodecError("SCHEMA_INVALID"),
      );
    }
    expect(() =>
      commerceContract.decode({
        ...listing,
        validFrom: "2026-02-30T00:00:00Z",
      }),
    ).toThrow(new CommerceCodecError("SCHEMA_INVALID"));
  });
});
