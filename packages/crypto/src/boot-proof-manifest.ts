/**
 * Borsh schemas + decoders for the QOS `Manifest` / `ManifestEnvelope` types
 * embedded in a `v1BootProof` (`qosManifestB64` / `qosManifestEnvelopeB64`).
 *
 * These mirror the Rust structs in
 * `enclave/vendor/qos/src/qos_core/src/protocol/services/boot.rs` field for
 * field. 0xkey manifests are borsh-encoded (NOT JSON — see the `proto`
 * comment "borsch serialized base64 encoded"), so this is the only way to
 * recover `manifestSetApprovals` and `enclave.pcr0-3` client-side.
 *
 * QOS keeps two manifest schema versions:
 *  - V1 (current production): `PivotConfig` includes `bridge_config` and
 *    `debug_mode`.
 *  - V0 (legacy): `PivotConfigV0` has neither field.
 * `qos_core`'s own `VersionedManifest`/`VersionedManifestEnvelope` try V1
 * first, then fall back to V0 (see `manifest.rs`). We mirror that exactly so
 * older archived boot proofs (e.g. in `enclave-releases`) still decode.
 */
import { serialize, deserialize } from "borsh";
import { sha256 } from "@noble/hashes/sha2";
import { uint8ArrayToHexString } from "@0xkey-io/encoding";

// ---------------------------------------------------------------------------
// Borsh schemas (borsh@2.x object-schema format)
// ---------------------------------------------------------------------------

const HASH256_SCHEMA = { array: { type: "u8", len: 32 } } as const;
const VEC_U8_SCHEMA = { array: { type: "u8" } } as const;

const QUORUM_MEMBER_SCHEMA = {
  struct: {
    alias: "string",
    pub_key: VEC_U8_SCHEMA,
  },
} as const;

const MEMBER_SET_SCHEMA = {
  struct: {
    threshold: "u32",
    members: { array: { type: QUORUM_MEMBER_SCHEMA } },
  },
} as const;

const MEMBER_PUB_KEY_SCHEMA = {
  struct: { pub_key: VEC_U8_SCHEMA },
} as const;

const PATCH_SET_SCHEMA = {
  struct: {
    threshold: "u32",
    members: { array: { type: MEMBER_PUB_KEY_SCHEMA } },
  },
} as const;

const NAMESPACE_SCHEMA = {
  struct: {
    name: "string",
    nonce: "u32",
    quorum_key: VEC_U8_SCHEMA,
  },
} as const;

const NITRO_CONFIG_SCHEMA = {
  struct: {
    pcr0: VEC_U8_SCHEMA,
    pcr1: VEC_U8_SCHEMA,
    pcr2: VEC_U8_SCHEMA,
    pcr3: VEC_U8_SCHEMA,
    aws_root_certificate: VEC_U8_SCHEMA,
    qos_commit: "string",
  },
} as const;

// Unit-variant enum: { Never: {} } | { Always: {} }
const RESTART_POLICY_SCHEMA = {
  enum: [
    { struct: { Never: { struct: {} } } },
    { struct: { Always: { struct: {} } } },
  ],
} as const;

// BridgeConfig::Server { port: u16, host: String } | Client { port: u16, host: Option<String> }
const BRIDGE_CONFIG_SCHEMA = {
  enum: [
    { struct: { Server: { struct: { port: "u16", host: "string" } } } },
    {
      struct: {
        Client: { struct: { port: "u16", host: { option: "string" } } },
      },
    },
  ],
} as const;

const PIVOT_CONFIG_V1_SCHEMA = {
  struct: {
    hash: HASH256_SCHEMA,
    restart: RESTART_POLICY_SCHEMA,
    bridge_config: { array: { type: BRIDGE_CONFIG_SCHEMA } },
    debug_mode: "bool",
    args: { array: { type: "string" } },
  },
} as const;

const PIVOT_CONFIG_V0_SCHEMA = {
  struct: {
    hash: HASH256_SCHEMA,
    restart: RESTART_POLICY_SCHEMA,
    args: { array: { type: "string" } },
  },
} as const;

function manifestSchema(pivotSchema: unknown) {
  return {
    struct: {
      namespace: NAMESPACE_SCHEMA,
      pivot: pivotSchema,
      manifest_set: MEMBER_SET_SCHEMA,
      share_set: MEMBER_SET_SCHEMA,
      enclave: NITRO_CONFIG_SCHEMA,
      patch_set: PATCH_SET_SCHEMA,
    },
  };
}

const MANIFEST_V1_SCHEMA = manifestSchema(PIVOT_CONFIG_V1_SCHEMA);
const MANIFEST_V0_SCHEMA = manifestSchema(PIVOT_CONFIG_V0_SCHEMA);

const APPROVAL_SCHEMA = {
  struct: {
    signature: VEC_U8_SCHEMA,
    member: QUORUM_MEMBER_SCHEMA,
  },
} as const;

function manifestEnvelopeSchema(manifestSchemaValue: unknown) {
  return {
    struct: {
      manifest: manifestSchemaValue,
      manifest_set_approvals: { array: { type: APPROVAL_SCHEMA } },
      share_set_approvals: { array: { type: APPROVAL_SCHEMA } },
    },
  };
}

const MANIFEST_ENVELOPE_V1_SCHEMA = manifestEnvelopeSchema(MANIFEST_V1_SCHEMA);
const MANIFEST_ENVELOPE_V0_SCHEMA = manifestEnvelopeSchema(MANIFEST_V0_SCHEMA);

// ---------------------------------------------------------------------------
// Raw decoded shapes (as produced by `borsh.deserialize`, pre-normalization)
// ---------------------------------------------------------------------------

type RawQuorumMember = { alias: string; pub_key: number[] };
type RawApproval = { signature: number[]; member: RawQuorumMember };
type RawManifest = {
  namespace: { name: string; nonce: number; quorum_key: number[] };
  pivot: { hash: number[] };
  manifest_set: { threshold: number; members: RawQuorumMember[] };
  enclave: {
    pcr0: number[];
    pcr1: number[];
    pcr2: number[];
    pcr3: number[];
  };
};
type RawManifestEnvelope = {
  manifest: RawManifest;
  manifest_set_approvals: RawApproval[];
  share_set_approvals: RawApproval[];
};

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * `borsh.deserialize` does not error on trailing/short-read bytes the way
 * Rust's `try_from_slice` does (which requires the entire buffer to be
 * consumed). We recover that guarantee by re-serializing the decoded value
 * and requiring an exact byte-for-byte match against the input — borsh is a
 * canonical encoding, so this is equivalent to (and just as strict as) an
 * offset check, without needing access to the library's internal cursor.
 */
function decodeExact<T>(schema: unknown, buffer: Uint8Array): T | null {
  let decoded: T;
  try {
    decoded = deserialize(schema as any, buffer) as T;
  } catch {
    return null;
  }
  let reencoded: Uint8Array;
  try {
    reencoded = serialize(schema as any, decoded);
  } catch {
    return null;
  }
  return bytesEqual(reencoded, buffer) ? decoded : null;
}

function toHex(bytes: number[]): string {
  return uint8ArrayToHexString(Uint8Array.from(bytes));
}

// ---------------------------------------------------------------------------
// Normalized, version-agnostic output types
// ---------------------------------------------------------------------------

export type QosManifestVersion = "v0" | "v1";

export interface ParsedQuorumMember {
  alias: string;
  /** Lowercase hex, 130 bytes (`P256Public` dual-key: encryption || signing). */
  pubKeyHex: string;
}

export interface ParsedApproval {
  /** Lowercase hex, 64 bytes (raw r||s). */
  signatureHex: string;
  member: ParsedQuorumMember;
}

export interface ParsedManifest {
  version: QosManifestVersion;
  namespace: {
    name: string;
    nonce: number;
    /** Lowercase hex, 130 bytes. */
    quorumKeyHex: string;
  };
  /** Lowercase hex, 32 bytes — the pivot binary hash the manifest approves. */
  pivotHashHex: string;
  manifestSet: {
    threshold: number;
    members: ParsedQuorumMember[];
  };
  enclave: {
    pcr0Hex: string;
    pcr1Hex: string;
    pcr2Hex: string;
    pcr3Hex: string;
  };
}

export interface ParsedManifestEnvelope {
  version: QosManifestVersion;
  manifest: ParsedManifest;
  manifestSetApprovals: ParsedApproval[];
  /**
   * `sha256(borsh(manifest))`, recomputed from the manifest embedded in
   * *this* envelope (independent of `qosManifestB64`). Callers must check
   * this equals the `H` derived from `qosManifestB64` / `user_data` before
   * trusting `manifestSetApprovals` or `enclave.pcr0-3` — otherwise a
   * tampered envelope could carry approvals for a different manifest than
   * the one actually bound to the attestation document.
   */
  manifestHashHex: string;
}

function normalizeMember(m: RawQuorumMember): ParsedQuorumMember {
  return { alias: m.alias, pubKeyHex: toHex(m.pub_key) };
}

function normalizeManifest(
  raw: RawManifest,
  version: QosManifestVersion,
): ParsedManifest {
  return {
    version,
    namespace: {
      name: raw.namespace.name,
      nonce: raw.namespace.nonce,
      quorumKeyHex: toHex(raw.namespace.quorum_key),
    },
    pivotHashHex: toHex(raw.pivot.hash),
    manifestSet: {
      threshold: raw.manifest_set.threshold,
      members: raw.manifest_set.members.map(normalizeMember),
    },
    enclave: {
      pcr0Hex: toHex(raw.enclave.pcr0),
      pcr1Hex: toHex(raw.enclave.pcr1),
      pcr2Hex: toHex(raw.enclave.pcr2),
      pcr3Hex: toHex(raw.enclave.pcr3),
    },
  };
}

/**
 * Decode a borsh-encoded QOS `Manifest`, trying the current V1 schema before
 * falling back to the legacy V0 schema (mirrors `VersionedManifest`'s Borsh
 * impl in `qos_core`).
 */
export function decodeVersionedManifest(buffer: Uint8Array): ParsedManifest {
  const v1 = decodeExact<RawManifest>(MANIFEST_V1_SCHEMA, buffer);
  if (v1) return normalizeManifest(v1, "v1");

  const v0 = decodeExact<RawManifest>(MANIFEST_V0_SCHEMA, buffer);
  if (v0) return normalizeManifest(v0, "v0");

  throw new Error(
    "Failed to decode QOS manifest as either v1 or v0 borsh schema",
  );
}

/**
 * Decode a borsh-encoded QOS `ManifestEnvelope`, trying V1 before falling
 * back to V0 (mirrors `VersionedManifestEnvelope`'s Borsh impl).
 */
export function decodeVersionedManifestEnvelope(
  buffer: Uint8Array,
): ParsedManifestEnvelope {
  const decodeWith = (
    envelopeSchema: unknown,
    manifestSchemaValue: unknown,
    version: QosManifestVersion,
  ): ParsedManifestEnvelope | null => {
    const raw = decodeExact<RawManifestEnvelope>(envelopeSchema, buffer);
    if (!raw) return null;

    const manifestBytes = serialize(manifestSchemaValue as any, raw.manifest);
    const manifestHashHex = uint8ArrayToHexString(sha256(manifestBytes));

    return {
      version,
      manifest: normalizeManifest(raw.manifest, version),
      manifestSetApprovals: raw.manifest_set_approvals.map((a) => ({
        signatureHex: toHex(a.signature),
        member: normalizeMember(a.member),
      })),
      manifestHashHex,
    };
  };

  const v1 = decodeWith(MANIFEST_ENVELOPE_V1_SCHEMA, MANIFEST_V1_SCHEMA, "v1");
  if (v1) return v1;

  const v0 = decodeWith(MANIFEST_ENVELOPE_V0_SCHEMA, MANIFEST_V0_SCHEMA, "v0");
  if (v0) return v0;

  throw new Error(
    "Failed to decode QOS manifest envelope as either v1 or v0 borsh schema",
  );
}
