use alloy_dyn_abi::TypedData;
use alloy_primitives::{Address, PrimitiveSignature, U256};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature as Ed25519Signature, VerifyingKey as Ed25519VerifyingKey};
use p256::ecdsa::{
    signature::Verifier, Signature as P256Signature, VerifyingKey as P256VerifyingKey,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub const BASE_USDC_CONTRACT: &str = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

#[derive(Debug, thiserror::Error)]
pub enum VerificationError {
    #[error("invalid JSON for RFC 8785 canonicalization: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("digest frame component {0} must be non-empty and NUL-free")]
    InvalidFrameComponent(&'static str),
    #[error("historical key registry is invalid: {0}")]
    InvalidKeyRegistry(String),
    #[error("detached JWS is malformed")]
    JwsMalformed,
    #[error("protected JWS header is invalid: {0}")]
    JwsHeaderInvalid(String),
    #[error("JWS audience does not match the verifier")]
    AudienceMismatch,
    #[error("envelope issuer does not match the protected JWS issuer")]
    IssuerMismatch,
    #[error("envelope key id does not match the protected JWS key id")]
    KeyIdMismatch,
    #[error("no exact historical key exists for issuer, kid, and role")]
    KeyNotFound,
    #[error("the matching key is registered for a different trust role")]
    KeyRoleMismatch,
    #[error("the key was not active at the trusted lifecycle evaluation time")]
    KeyNotActive,
    #[error("the key was revoked at the trusted lifecycle evaluation time")]
    KeyRevoked,
    #[error("the signed statement is dated after the verification observation")]
    StatementFromFuture,
    #[error("statement preimage does not reproduce signedObjectDigest")]
    StatementDigestMismatch,
    #[error("digest-bound statement issuedAt is missing or invalid")]
    StatementIssuedAtInvalid,
    #[error("signature encoding is invalid")]
    SignatureEncodingInvalid,
    #[error("signature is valid ECDSA but uses non-canonical high-S form")]
    SignatureNonCanonical,
    #[error("signature verification failed")]
    SignatureInvalid,
    #[error("EIP-712 proof is malformed: {0}")]
    Eip712Malformed(String),
    #[error("complete TypedData does not match paymentAuthorizationDigest")]
    AuthorizationDigestMismatch,
    #[error("EIP-712 envelope identity or claims digest does not match trusted context")]
    EnvelopeBindingMismatch,
    #[error("EIP-712 TransferWithAuthorization message does not match trusted context")]
    AuthorizationMessageMismatch,
    #[error("WalletAuthorizationProof claims do not reproduce the receipt claims digest")]
    WalletClaimsDigestMismatch,
    #[error("EIP-712 TransferWithAuthorization domain does not match the fixed protocol domain")]
    AuthorizationDomainMismatch,
    #[error("recovered EIP-712 signer does not match payerAddress")]
    PayerAddressMismatch,
    #[error("PaymentAuthorization asset does not match the explicit Phase 0 asset context")]
    AuthorizationAssetMismatch,
    #[error("trusted authorization time is outside the Wallet proof validity interval")]
    AuthorizationTimeInvalid,
    #[error("the verifier-owned live system clock is unavailable")]
    SystemClockUnavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VerificationErrorCode {
    InvalidJson,
    InvalidFrameComponent,
    InvalidKeyRegistry,
    JwsMalformed,
    JwsHeaderInvalid,
    AudienceMismatch,
    IssuerMismatch,
    KeyIdMismatch,
    KeyNotFound,
    KeyRoleMismatch,
    KeyNotActive,
    KeyRevoked,
    StatementFromFuture,
    StatementDigestMismatch,
    StatementIssuedAtInvalid,
    SignatureEncodingInvalid,
    SignatureNonCanonical,
    SignatureInvalid,
    Eip712Malformed,
    AuthorizationDigestMismatch,
    EnvelopeBindingMismatch,
    AuthorizationMessageMismatch,
    WalletClaimsDigestMismatch,
    AuthorizationDomainMismatch,
    PayerAddressMismatch,
    AuthorizationAssetMismatch,
    AuthorizationTimeInvalid,
    SystemClockUnavailable,
}

impl VerificationError {
    pub const fn code(&self) -> VerificationErrorCode {
        match self {
            Self::InvalidJson(_) => VerificationErrorCode::InvalidJson,
            Self::InvalidFrameComponent(_) => VerificationErrorCode::InvalidFrameComponent,
            Self::InvalidKeyRegistry(_) => VerificationErrorCode::InvalidKeyRegistry,
            Self::JwsMalformed => VerificationErrorCode::JwsMalformed,
            Self::JwsHeaderInvalid(_) => VerificationErrorCode::JwsHeaderInvalid,
            Self::AudienceMismatch => VerificationErrorCode::AudienceMismatch,
            Self::IssuerMismatch => VerificationErrorCode::IssuerMismatch,
            Self::KeyIdMismatch => VerificationErrorCode::KeyIdMismatch,
            Self::KeyNotFound => VerificationErrorCode::KeyNotFound,
            Self::KeyRoleMismatch => VerificationErrorCode::KeyRoleMismatch,
            Self::KeyNotActive => VerificationErrorCode::KeyNotActive,
            Self::KeyRevoked => VerificationErrorCode::KeyRevoked,
            Self::StatementFromFuture => VerificationErrorCode::StatementFromFuture,
            Self::StatementDigestMismatch => VerificationErrorCode::StatementDigestMismatch,
            Self::StatementIssuedAtInvalid => VerificationErrorCode::StatementIssuedAtInvalid,
            Self::SignatureEncodingInvalid => VerificationErrorCode::SignatureEncodingInvalid,
            Self::SignatureNonCanonical => VerificationErrorCode::SignatureNonCanonical,
            Self::SignatureInvalid => VerificationErrorCode::SignatureInvalid,
            Self::Eip712Malformed(_) => VerificationErrorCode::Eip712Malformed,
            Self::AuthorizationDigestMismatch => VerificationErrorCode::AuthorizationDigestMismatch,
            Self::EnvelopeBindingMismatch => VerificationErrorCode::EnvelopeBindingMismatch,
            Self::AuthorizationMessageMismatch => {
                VerificationErrorCode::AuthorizationMessageMismatch
            }
            Self::WalletClaimsDigestMismatch => VerificationErrorCode::WalletClaimsDigestMismatch,
            Self::AuthorizationDomainMismatch => VerificationErrorCode::AuthorizationDomainMismatch,
            Self::PayerAddressMismatch => VerificationErrorCode::PayerAddressMismatch,
            Self::AuthorizationAssetMismatch => VerificationErrorCode::AuthorizationAssetMismatch,
            Self::AuthorizationTimeInvalid => VerificationErrorCode::AuthorizationTimeInvalid,
            Self::SystemClockUnavailable => VerificationErrorCode::SystemClockUnavailable,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
pub enum KeyRole {
    #[serde(rename = "ISSUER")]
    Issuer,
    #[serde(rename = "CUSTODY")]
    Custody,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
pub enum JwsAlgorithm {
    ES256,
    EdDSA,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignatureEnvelope {
    pub scheme: SignatureScheme,
    pub issuer: String,
    pub key_id: String,
    pub signed_object_digest: String,
    pub signature: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
pub enum SignatureScheme {
    #[serde(rename = "DETACHED_JWS_ES256")]
    DetachedJwsEs256,
    #[serde(rename = "DETACHED_JWS_EDDSA")]
    DetachedJwsEddsa,
    #[serde(rename = "EIP712")]
    Eip712,
    #[serde(rename = "APP_PROOF_COMMERCE_V1")]
    AppProofCommerceV1,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoricalJwk {
    pub issuer: String,
    pub kid: String,
    pub role: KeyRole,
    pub algorithm: JwsAlgorithm,
    pub not_before_unix_ms: i64,
    pub not_after_unix_ms: Option<i64>,
    pub revoked_at_unix_ms: Option<i64>,
    pub jwk: Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoricalKeyWindow {
    pub kid: String,
    pub role: KeyRole,
    pub algorithm: JwsAlgorithm,
    pub not_before_unix_ms: i64,
    pub not_after_unix_ms: Option<i64>,
    pub revoked_at_unix_ms: Option<i64>,
}

pub struct DigestBoundStatement<'a> {
    pub profile: &'a str,
    pub preimage: &'a Value,
    pub wire_version: &'a str,
}

/// Live detached-JWS verification context.
///
/// The lifecycle observation instant is deliberately absent and cannot be backfilled by
/// a caller. `verify_detached_jws` reads the verifier-owned system clock for every call.
///
/// ```compile_fail
/// # use openant_commerce_verifier::{DigestBoundStatement, KeyRole, VerificationContext};
/// # use serde_json::Value;
/// # fn cannot_backfill<'a>(preimage: &'a Value) {
/// let _ = VerificationContext {
///     audience: "openant-commerce-verifier",
///     required_role: KeyRole::Issuer,
///     statement: DigestBoundStatement { profile: "TEST", preimage, wire_version: "0.1" },
///     observed_at_unix_ms: 0,
/// };
/// # }
/// ```
pub struct VerificationContext<'a> {
    pub audience: &'a str,
    pub required_role: KeyRole,
    pub statement: DigestBoundStatement<'a>,
}

#[derive(Debug)]
enum PublicKey {
    P256(P256VerifyingKey),
    Ed25519(Ed25519VerifyingKey),
}

#[derive(Debug)]
struct RegisteredKey {
    metadata: HistoricalJwk,
    key: PublicKey,
    fingerprint: [u8; 32],
}

#[derive(Debug)]
pub struct HistoricalKeyRegistry {
    keys: Vec<RegisteredKey>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedJws {
    pub issuer: String,
    pub key_id: String,
    pub algorithm: JwsAlgorithm,
    pub signed_object_digest: String,
    pub statement_issued_at_unix_ms: i64,
    pub key_lifecycle_time_unix_ms: i64,
}

/// Live wallet-proof verification context. Historical authorization-time override is not
/// part of the public API; verifiable TSA/transparency-log evidence requires a future profile.
///
/// ```compile_fail
/// # use openant_commerce_verifier::{WalletAuthorizationProofClaims, WalletVerificationContext};
/// # fn cannot_backfill<'a>(claims: &'a WalletAuthorizationProofClaims) {
/// let _ = WalletVerificationContext {
///     wallet_proof_claims: claims,
///     claimed_claims_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
///     wire_version: "0.1",
///     trusted_authorization_time_unix_ms: 0,
/// };
/// # }
/// ```
pub struct WalletVerificationContext<'a> {
    pub wallet_proof_claims: &'a WalletAuthorizationProofClaims,
    pub claimed_claims_digest: &'a str,
    pub wire_version: &'a str,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaymentAuthorizationMessage {
    pub from: String,
    pub to: String,
    pub value: String,
    pub valid_after: String,
    pub valid_before: String,
    pub nonce: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WalletProofIssuer {
    pub issuer: String,
    pub key_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BaseUsdcAsset {
    pub network: String,
    pub namespace: String,
    pub reference: String,
    pub symbol: String,
    pub decimals: u8,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WalletProofAssurance {
    pub authorization: String,
    pub settlement: String,
    pub delivery: String,
    pub content_custody: String,
    pub identity: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WalletAuthorizationProofClaims {
    pub object_type: String,
    pub protocol_version: String,
    pub receipt_id: String,
    pub invocation_id: String,
    pub issued_at: String,
    pub issuer: WalletProofIssuer,
    pub payment_intent_id: String,
    pub payment_intent_fingerprint_digest: String,
    pub buyer_actor_ref: String,
    pub service_sku_version_digest: String,
    pub challenge_digest: String,
    pub payment_authorization_digest: String,
    pub expires_at: String,
    pub amount_atomic: String,
    pub asset: BaseUsdcAsset,
    pub payer_address: String,
    pub payee_address: String,
    pub mode: String,
    pub requested_assurance: WalletProofAssurance,
    pub facilitator_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClosedPaymentAuthorizationTypedData {
    domain: ClosedPaymentAuthorizationDomain,
    types: Value,
    primary_type: String,
    message: PaymentAuthorizationMessage,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClosedPaymentAuthorizationDomain {
    name: String,
    version: String,
    chain_id: u64,
    verifying_contract: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedWalletProof {
    pub issuer: String,
    pub key_id: String,
    pub signed_object_digest: String,
    pub payer_address: String,
    pub payment_authorization_digest: String,
    pub claims_digest: String,
    pub eip712_signing_hash: String,
    pub message: PaymentAuthorizationMessage,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProtectedHeader {
    alg: JwsAlgorithm,
    aud: String,
    iss: String,
    kid: String,
    typ: String,
}

impl HistoricalKeyRegistry {
    pub fn new(keys: Vec<HistoricalJwk>) -> Result<Self, VerificationError> {
        let mut registered = Vec::with_capacity(keys.len());
        for metadata in keys {
            let key = parse_public_jwk(metadata.algorithm, &metadata.jwk)?;
            let fingerprint = public_key_fingerprint(&key);
            validate_key_metadata(&metadata, fingerprint, &registered)?;
            registered.push(RegisteredKey {
                metadata,
                key,
                fingerprint,
            });
        }
        Ok(Self { keys: registered })
    }

    /// Imports public JWKs from an RFC 7517 JWKS document and combines them with
    /// trusted, verifier-local role and validity metadata.
    ///
    /// The JWKS cannot self-assert issuer, custody role, activation, or revocation.
    /// Each trusted window selects exactly one canonical `kid`; unknown and duplicate
    /// kids fail closed rather than falling back to another key.
    pub fn from_jwks(
        issuer: &str,
        jwks: &Value,
        windows: Vec<HistoricalKeyWindow>,
    ) -> Result<Self, VerificationError> {
        if !is_protocol_identifier(issuer) {
            return Err(VerificationError::InvalidKeyRegistry(
                "JWKS issuer must be a protocol identifier".into(),
            ));
        }
        let entries = jwks
            .as_object()
            .and_then(|object| object.get("keys"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                VerificationError::InvalidKeyRegistry("JWKS keys array is required".into())
            })?;
        let mut by_kid = std::collections::HashMap::new();
        for entry in entries {
            let kid = entry
                .as_object()
                .and_then(|object| object.get("kid"))
                .and_then(Value::as_str)
                .filter(|kid| !kid.is_empty())
                .ok_or_else(|| {
                    VerificationError::InvalidKeyRegistry(
                        "every JWKS key needs a non-empty kid".into(),
                    )
                })?;
            if by_kid.insert(kid.to_owned(), entry.clone()).is_some() {
                return Err(VerificationError::InvalidKeyRegistry(
                    "duplicate JWKS kid".into(),
                ));
            }
        }

        let keys = windows
            .into_iter()
            .map(|window| {
                let jwk = by_kid.get(&window.kid).cloned().ok_or_else(|| {
                    VerificationError::InvalidKeyRegistry(format!(
                        "trusted window references missing JWKS kid {}",
                        window.kid
                    ))
                })?;
                Ok(HistoricalJwk {
                    issuer: issuer.to_owned(),
                    kid: window.kid,
                    role: window.role,
                    algorithm: window.algorithm,
                    not_before_unix_ms: window.not_before_unix_ms,
                    not_after_unix_ms: window.not_after_unix_ms,
                    revoked_at_unix_ms: window.revoked_at_unix_ms,
                    jwk,
                })
            })
            .collect::<Result<Vec<_>, VerificationError>>()?;
        Self::new(keys)
    }

    pub fn verify_detached_jws(
        &self,
        envelope: &SignatureEnvelope,
        context: &VerificationContext<'_>,
    ) -> Result<VerifiedJws, VerificationError> {
        self.verify_detached_jws_observed_at(envelope, context, live_observation_time_unix_ms()?)
    }

    fn verify_detached_jws_observed_at(
        &self,
        envelope: &SignatureEnvelope,
        context: &VerificationContext<'_>,
        observed_at_unix_ms: i64,
    ) -> Result<VerifiedJws, VerificationError> {
        if !is_sha256_digest(&envelope.signed_object_digest)
            || !is_protocol_identifier(context.audience)
            || !is_protocol_identifier(&envelope.issuer)
            || !is_protocol_identifier(&envelope.key_id)
        {
            return Err(VerificationError::JwsMalformed);
        }

        let computed_statement_digest = digest_structured(
            context.statement.profile,
            context.statement.preimage,
            context.statement.wire_version,
        )?;
        if computed_statement_digest != envelope.signed_object_digest {
            return Err(VerificationError::StatementDigestMismatch);
        }
        let statement_issued_at_unix_ms = parse_statement_issued_at(context.statement.preimage)?;

        let mut segments = envelope.signature.split('.');
        let protected_segment = segments.next().ok_or(VerificationError::JwsMalformed)?;
        let payload_segment = segments.next().ok_or(VerificationError::JwsMalformed)?;
        let signature_segment = segments.next().ok_or(VerificationError::JwsMalformed)?;
        if segments.next().is_some()
            || protected_segment.is_empty()
            || !payload_segment.is_empty()
            || signature_segment.is_empty()
        {
            return Err(VerificationError::JwsMalformed);
        }

        let protected_bytes = decode_base64url(protected_segment, VerificationError::JwsMalformed)?;
        let header: ProtectedHeader = serde_json::from_slice(&protected_bytes)
            .map_err(|error| VerificationError::JwsHeaderInvalid(error.to_string()))?;
        if header.typ != "openant-commerce+jws"
            || !is_protocol_identifier(&header.aud)
            || !is_protocol_identifier(&header.iss)
            || !is_protocol_identifier(&header.kid)
        {
            return Err(VerificationError::JwsHeaderInvalid(
                "typ does not identify OpenAnt Commerce".into(),
            ));
        }
        if header.aud != context.audience {
            return Err(VerificationError::AudienceMismatch);
        }
        if header.iss != envelope.issuer {
            return Err(VerificationError::IssuerMismatch);
        }
        if header.kid != envelope.key_id {
            return Err(VerificationError::KeyIdMismatch);
        }
        let expected_algorithm = match envelope.scheme {
            SignatureScheme::DetachedJwsEs256 => JwsAlgorithm::ES256,
            SignatureScheme::DetachedJwsEddsa => JwsAlgorithm::EdDSA,
            _ => return Err(VerificationError::JwsMalformed),
        };
        if header.alg != expected_algorithm {
            return Err(VerificationError::JwsHeaderInvalid(
                "scheme and alg do not match".into(),
            ));
        }

        let matching_identity: Vec<_> = self
            .keys
            .iter()
            .filter(|candidate| {
                candidate.metadata.issuer == envelope.issuer
                    && candidate.metadata.kid == envelope.key_id
            })
            .collect();
        let registered = matching_identity
            .iter()
            .find(|candidate| candidate.metadata.role == context.required_role)
            .copied()
            .ok_or({
                if matching_identity.is_empty() {
                    VerificationError::KeyNotFound
                } else {
                    VerificationError::KeyRoleMismatch
                }
            })?;
        if registered.metadata.algorithm != header.alg {
            return Err(VerificationError::JwsHeaderInvalid(
                "alg does not match the registered key".into(),
            ));
        }
        let signature = decode_base64url(
            signature_segment,
            VerificationError::SignatureEncodingInvalid,
        )?;
        let payload = URL_SAFE_NO_PAD.encode(envelope.signed_object_digest.as_bytes());
        let signing_input = format!("{protected_segment}.{payload}");
        match (&registered.key, header.alg) {
            (PublicKey::P256(key), JwsAlgorithm::ES256) => {
                if signature.len() != 64 {
                    return Err(VerificationError::SignatureEncodingInvalid);
                }
                let signature = P256Signature::from_slice(&signature)
                    .map_err(|_| VerificationError::SignatureEncodingInvalid)?;
                if signature.normalize_s().is_some() {
                    return Err(VerificationError::SignatureNonCanonical);
                }
                key.verify(signing_input.as_bytes(), &signature)
                    .map_err(|_| VerificationError::SignatureInvalid)?;
            }
            (PublicKey::Ed25519(key), JwsAlgorithm::EdDSA) => {
                let signature = Ed25519Signature::from_slice(&signature)
                    .map_err(|_| VerificationError::SignatureEncodingInvalid)?;
                key.verify_strict(signing_input.as_bytes(), &signature)
                    .map_err(|_| VerificationError::SignatureInvalid)?;
            }
            _ => {
                return Err(VerificationError::JwsHeaderInvalid(
                    "algorithm/key confusion is forbidden".into(),
                ))
            }
        }

        if statement_issued_at_unix_ms > observed_at_unix_ms {
            return Err(VerificationError::StatementFromFuture);
        }
        if observed_at_unix_ms < registered.metadata.not_before_unix_ms
            || registered
                .metadata
                .not_after_unix_ms
                .is_some_and(|end| observed_at_unix_ms >= end)
        {
            return Err(VerificationError::KeyNotActive);
        }
        if registered
            .metadata
            .revoked_at_unix_ms
            .is_some_and(|revoked| observed_at_unix_ms >= revoked)
        {
            return Err(VerificationError::KeyRevoked);
        }

        Ok(VerifiedJws {
            issuer: envelope.issuer.clone(),
            key_id: envelope.key_id.clone(),
            algorithm: header.alg,
            signed_object_digest: envelope.signed_object_digest.clone(),
            statement_issued_at_unix_ms,
            key_lifecycle_time_unix_ms: observed_at_unix_ms,
        })
    }
}

fn parse_statement_issued_at(statement: &Value) -> Result<i64, VerificationError> {
    let issued_at = statement
        .as_object()
        .and_then(|object| object.get("issuedAt"))
        .and_then(Value::as_str)
        .ok_or(VerificationError::StatementIssuedAtInvalid)?;
    parse_rfc3339_utc_whole_seconds_value(issued_at)
        .ok_or(VerificationError::StatementIssuedAtInvalid)
}

/// Verifies a Phase 0 x402 v2 exact EIP-3009 authorization and derives the
/// WalletAuthorizationProof receipt-claims digest.
///
/// The wallet signature proves only the fixed Base USDC `TransferWithAuthorization`.
/// Commercial context is bound indirectly because its PaymentIntent fingerprint is the
/// EIP-3009 nonce. The returned `claims_digest` is derived independently; it is not
/// represented as if the EIP-3009 signature directly signed the receipt claims.
pub fn verify_eip712_wallet(
    envelope: &SignatureEnvelope,
    typed_data_json: &Value,
    context: &WalletVerificationContext<'_>,
) -> Result<VerifiedWalletProof, VerificationError> {
    verify_eip712_wallet_observed_at(
        envelope,
        typed_data_json,
        context,
        live_observation_time_unix_ms()?,
    )
}

fn verify_eip712_wallet_observed_at(
    envelope: &SignatureEnvelope,
    typed_data_json: &Value,
    context: &WalletVerificationContext<'_>,
    observed_at_unix_ms: i64,
) -> Result<VerifiedWalletProof, VerificationError> {
    if context.wire_version != "0.1" {
        return Err(VerificationError::Eip712Malformed(
            "TransferWithAuthorization supports only wire version 0.1".into(),
        ));
    }
    if envelope.scheme != SignatureScheme::Eip712
        || !is_sha256_digest(&envelope.signed_object_digest)
    {
        return Err(VerificationError::Eip712Malformed(
            "scheme or signedObjectDigest is invalid".into(),
        ));
    }
    let claims = context.wallet_proof_claims;
    if envelope.issuer != claims.buyer_actor_ref
        || envelope.issuer != claims.issuer.issuer
        || envelope.key_id != claims.issuer.key_id
    {
        return Err(VerificationError::EnvelopeBindingMismatch);
    }

    let (wallet_claims_issued_at, wallet_claims_expires_at) = validate_wallet_proof_claims(claims)?;
    if observed_at_unix_ms < wallet_claims_issued_at
        || observed_at_unix_ms >= wallet_claims_expires_at
    {
        return Err(VerificationError::AuthorizationTimeInvalid);
    }

    let closed: ClosedPaymentAuthorizationTypedData =
        serde_json::from_value(typed_data_json.clone())
            .map_err(|error| VerificationError::Eip712Malformed(error.to_string()))?;
    if closed.primary_type != "TransferWithAuthorization"
        || closed.types != payment_authorization_types()
    {
        return Err(VerificationError::Eip712Malformed(
            "primaryType and types must be the closed x402 EIP-3009 contract".into(),
        ));
    }
    let actual_contract = Address::from_str(&closed.domain.verifying_contract)
        .map_err(|_| VerificationError::Eip712Malformed("domain contract is invalid".into()))?;
    let phase0_asset = Address::from_str(BASE_USDC_CONTRACT)
        .map_err(|_| VerificationError::Eip712Malformed("Phase 0 asset is invalid".into()))?;
    if closed.domain.name != "USD Coin"
        || closed.domain.version != "2"
        || closed.domain.chain_id != 8453
        || closed.domain.verifying_contract != BASE_USDC_CONTRACT
        || actual_contract != phase0_asset
    {
        return Err(VerificationError::AuthorizationDomainMismatch);
    }
    validate_payment_authorization_message(&closed.message)?;
    let expected_message = payment_authorization_message_from_claims(claims)?;
    if closed.message != expected_message {
        return Err(VerificationError::AuthorizationMessageMismatch);
    }
    let message_payer = Address::from_str(&closed.message.from)
        .map_err(|_| VerificationError::Eip712Malformed("message payer is invalid".into()))?;
    let expected_payer = Address::from_str(&claims.payer_address)
        .map_err(|_| VerificationError::Eip712Malformed("payerAddress is invalid".into()))?;
    if message_payer != expected_payer {
        return Err(VerificationError::PayerAddressMismatch);
    }

    let computed_authorization_digest = digest_structured(
        "PAYMENT_AUTHORIZATION",
        typed_data_json,
        context.wire_version,
    )?;
    if computed_authorization_digest != claims.payment_authorization_digest
        || computed_authorization_digest != envelope.signed_object_digest
    {
        return Err(VerificationError::AuthorizationDigestMismatch);
    }

    let wallet_claims_value = serde_json::to_value(claims)?;
    let claims_digest =
        digest_structured("RECEIPT_CLAIMS", &wallet_claims_value, context.wire_version)?;
    if !is_sha256_digest(context.claimed_claims_digest)
        || claims_digest != context.claimed_claims_digest
    {
        return Err(VerificationError::WalletClaimsDigestMismatch);
    }

    let typed_data: TypedData = serde_json::from_value(typed_data_json.clone())
        .map_err(|error| VerificationError::Eip712Malformed(error.to_string()))?;
    let signing_hash = typed_data
        .eip712_signing_hash()
        .map_err(|error| VerificationError::Eip712Malformed(error.to_string()))?;

    let signature_text = envelope
        .signature
        .strip_prefix("0x")
        .ok_or_else(|| VerificationError::Eip712Malformed("signature needs 0x prefix".into()))?;
    if signature_text.len() != 130
        || !signature_text
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(VerificationError::SignatureEncodingInvalid);
    }
    let signature_bytes =
        hex::decode(signature_text).map_err(|_| VerificationError::SignatureEncodingInvalid)?;
    if !matches!(signature_bytes[64], 27 | 28) {
        return Err(VerificationError::SignatureEncodingInvalid);
    }
    let signature = PrimitiveSignature::from_raw(&signature_bytes)
        .map_err(|_| VerificationError::SignatureEncodingInvalid)?;
    signature
        .to_k256()
        .map_err(|_| VerificationError::SignatureEncodingInvalid)?;
    if signature.normalize_s().is_some() {
        return Err(VerificationError::SignatureNonCanonical);
    }
    let recovered = signature
        .recover_address_from_prehash(&signing_hash)
        .map_err(|_| VerificationError::SignatureInvalid)?;
    if recovered != expected_payer || recovered != message_payer {
        return Err(VerificationError::PayerAddressMismatch);
    }

    Ok(VerifiedWalletProof {
        issuer: envelope.issuer.clone(),
        key_id: envelope.key_id.clone(),
        signed_object_digest: envelope.signed_object_digest.clone(),
        payer_address: format!("{recovered:#x}"),
        payment_authorization_digest: computed_authorization_digest,
        claims_digest,
        eip712_signing_hash: format!("{signing_hash:#x}"),
        message: closed.message,
    })
}

fn payment_authorization_types() -> Value {
    serde_json::json!({
        "TransferWithAuthorization": [
            {"name": "from", "type": "address"},
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "validAfter", "type": "uint256"},
            {"name": "validBefore", "type": "uint256"},
            {"name": "nonce", "type": "bytes32"}
        ]
    })
}

fn validate_payment_authorization_message(
    message: &PaymentAuthorizationMessage,
) -> Result<(), VerificationError> {
    if !is_positive_uint256_decimal(&message.value)
        || message.valid_after != "0"
        || !is_positive_uint256_decimal(&message.valid_before)
        || !is_bytes32(&message.nonce)
    {
        return Err(VerificationError::Eip712Malformed(
            "TransferWithAuthorization message fields are invalid".into(),
        ));
    }
    for address in [&message.from, &message.to] {
        let parsed = Address::from_str(address)
            .map_err(|_| VerificationError::Eip712Malformed("message address is invalid".into()))?;
        if parsed.is_zero() || format!("{parsed:#x}") != *address {
            return Err(VerificationError::Eip712Malformed(
                "message address must be non-zero canonical lowercase".into(),
            ));
        }
    }
    Ok(())
}

fn validate_wallet_proof_claims(
    claims: &WalletAuthorizationProofClaims,
) -> Result<(i64, i64), VerificationError> {
    if claims.object_type != "WalletAuthorizationProof"
        || claims.protocol_version != "0.1"
        || claims.asset.network != "eip155:8453"
        || claims.asset.namespace != "erc20"
        || claims.asset.reference != BASE_USDC_CONTRACT
        || claims.asset.symbol != "USDC"
        || claims.asset.decimals != 6
        || !is_sha256_digest(&claims.payment_intent_fingerprint_digest)
        || !is_sha256_digest(&claims.service_sku_version_digest)
        || !is_sha256_digest(&claims.challenge_digest)
        || !is_sha256_digest(&claims.payment_authorization_digest)
        || !is_protocol_identifier(&claims.receipt_id)
        || !is_protocol_identifier(&claims.invocation_id)
        || !is_protocol_identifier(&claims.payment_intent_id)
        || !is_protocol_identifier(&claims.buyer_actor_ref)
        || !is_protocol_identifier(&claims.issuer.issuer)
        || !is_protocol_identifier(&claims.issuer.key_id)
        || !is_protocol_identifier(&claims.facilitator_id)
        || claims.issuer.issuer != claims.buyer_actor_ref
        || !is_positive_uint256_decimal(&claims.amount_atomic)
        || !matches!(claims.mode.as_str(), "HOSTED" | "DIRECT")
        || !matches!(
            claims.requested_assurance.authorization.as_str(),
            "NONE" | "WALLET_SIGNED" | "MANDATE_PROTECTED"
        )
        || !matches!(
            claims.requested_assurance.settlement.as_str(),
            "NONE" | "SUBMITTED_ONLY" | "FINALITY_VERIFIED"
        )
        || !matches!(
            claims.requested_assurance.delivery.as_str(),
            "NONE" | "SELLER_ASSERTED" | "DIRECT_BUYER_ACCEPTED" | "HOSTED_RECOVERABLE"
        )
        || !matches!(
            claims.requested_assurance.content_custody.as_str(),
            "DIRECT" | "HOSTED_EPHEMERAL" | "HOSTED_ENCRYPTED_BUFFER"
        )
        || !matches!(
            claims.requested_assurance.identity.as_str(),
            "ANONYMOUS_WALLET" | "PLATFORM_BOUND" | "VERIFIED_SELLER"
        )
    {
        return Err(VerificationError::Eip712Malformed(
            "Wallet proof claims projection is invalid".into(),
        ));
    }
    for address in [&claims.payer_address, &claims.payee_address] {
        if !is_non_zero_evm_address(address) {
            return Err(VerificationError::Eip712Malformed(
                "Wallet proof address must be 0x-prefixed, 20-byte hex, and non-zero".into(),
            ));
        }
    }
    let issued_at = parse_rfc3339_utc_whole_seconds(&claims.issued_at)?;
    let expires_at = parse_rfc3339_utc_whole_seconds(&claims.expires_at)?;
    if issued_at >= expires_at {
        return Err(VerificationError::AuthorizationTimeInvalid);
    }
    Ok((issued_at, expires_at))
}

fn payment_authorization_message_from_claims(
    claims: &WalletAuthorizationProofClaims,
) -> Result<PaymentAuthorizationMessage, VerificationError> {
    let expires_at_ms = parse_rfc3339_utc_whole_seconds(&claims.expires_at)?;
    let fingerprint = claims
        .payment_intent_fingerprint_digest
        .strip_prefix("sha256:")
        .ok_or_else(|| VerificationError::Eip712Malformed("fingerprint is invalid".into()))?;
    Ok(PaymentAuthorizationMessage {
        from: canonical_address(&claims.payer_address)?,
        to: canonical_address(&claims.payee_address)?,
        value: claims.amount_atomic.clone(),
        valid_after: "0".into(),
        valid_before: (expires_at_ms / 1_000).to_string(),
        nonce: format!("0x{fingerprint}"),
    })
}

fn canonical_address(value: &str) -> Result<String, VerificationError> {
    let address = Address::from_str(value)
        .map_err(|_| VerificationError::Eip712Malformed("address is invalid".into()))?;
    if address.is_zero() {
        return Err(VerificationError::Eip712Malformed(
            "address cannot be zero".into(),
        ));
    }
    Ok(format!("{address:#x}"))
}

fn is_bytes32(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value[2..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn live_observation_time_unix_ms() -> Result<i64, VerificationError> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| VerificationError::SystemClockUnavailable)?;
    let seconds =
        i64::try_from(elapsed.as_secs()).map_err(|_| VerificationError::SystemClockUnavailable)?;
    seconds
        .checked_mul(1_000)
        .ok_or(VerificationError::SystemClockUnavailable)
}

pub fn is_non_zero_evm_address(value: &str) -> bool {
    value.len() == 42
        && value.starts_with("0x")
        && value[2..].bytes().all(|byte| byte.is_ascii_hexdigit())
        && Address::from_str(value).is_ok_and(|address| !address.is_zero())
}

pub fn is_positive_uint256_decimal(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('0')
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && U256::from_str(value).is_ok()
}

fn parse_rfc3339_utc_whole_seconds(value: &str) -> Result<i64, VerificationError> {
    parse_rfc3339_utc_whole_seconds_value(value).ok_or_else(|| {
        VerificationError::Eip712Malformed(
            "time must be a valid RFC 3339 UTC instant with whole seconds".into(),
        )
    })
}

fn parse_rfc3339_utc_whole_seconds_value(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    let exact_shape = bytes.len() == 20
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
        && bytes[16] == b':'
        && bytes[19] == b'Z'
        && bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7 | 10 | 13 | 16 | 19) || byte.is_ascii_digit()
        });
    if !exact_shape || value.starts_with("0000-") {
        return None;
    }
    let parsed = OffsetDateTime::parse(value, &Rfc3339).ok()?;
    i64::try_from(parsed.unix_timestamp_nanos() / 1_000_000).ok()
}

fn validate_key_metadata(
    key: &HistoricalJwk,
    fingerprint: [u8; 32],
    existing: &[RegisteredKey],
) -> Result<(), VerificationError> {
    if !is_protocol_identifier(&key.issuer) || !is_protocol_identifier(&key.kid) {
        return Err(VerificationError::InvalidKeyRegistry(
            "issuer and kid must be protocol identifiers".into(),
        ));
    }
    if key
        .jwk
        .as_object()
        .and_then(|object| object.get("kid"))
        .is_some_and(|kid| kid.as_str() != Some(key.kid.as_str()))
    {
        return Err(VerificationError::InvalidKeyRegistry(
            "JWK kid must match trusted historical metadata".into(),
        ));
    }
    if key
        .not_after_unix_ms
        .is_some_and(|end| end <= key.not_before_unix_ms)
    {
        return Err(VerificationError::InvalidKeyRegistry(
            "notAfter must be later than notBefore".into(),
        ));
    }
    if existing.iter().any(|candidate| {
        candidate.metadata.issuer == key.issuer && candidate.metadata.kid == key.kid
    }) {
        return Err(VerificationError::InvalidKeyRegistry(
            "issuer/kid entries must be unique across all roles".into(),
        ));
    }
    if existing
        .iter()
        .any(|candidate| candidate.fingerprint == fingerprint)
    {
        return Err(VerificationError::InvalidKeyRegistry(
            "one public key cannot be relabeled across kids or trust roles".into(),
        ));
    }
    Ok(())
}

fn public_key_fingerprint(key: &PublicKey) -> [u8; 32] {
    let mut hasher = Sha256::new();
    match key {
        PublicKey::P256(key) => {
            hasher.update(b"ES256\0");
            hasher.update(key.to_encoded_point(false).as_bytes());
        }
        PublicKey::Ed25519(key) => {
            hasher.update(b"EdDSA\0");
            hasher.update(key.as_bytes());
        }
    }
    hasher.finalize().into()
}

fn parse_public_jwk(algorithm: JwsAlgorithm, jwk: &Value) -> Result<PublicKey, VerificationError> {
    let object = jwk
        .as_object()
        .ok_or_else(|| VerificationError::InvalidKeyRegistry("JWK must be an object".into()))?;
    if object.contains_key("d") {
        return Err(VerificationError::InvalidKeyRegistry(
            "private JWK material is forbidden in the verifier registry".into(),
        ));
    }
    if object.get("use").and_then(Value::as_str) != Some("sig") {
        return Err(VerificationError::InvalidKeyRegistry(
            "JWK use must be exactly sig".into(),
        ));
    }
    if let Some(operations) = object.get("key_ops") {
        let operations = operations.as_array().ok_or_else(|| {
            VerificationError::InvalidKeyRegistry("JWK key_ops must be an array".into())
        })?;
        if operations.len() != 1 || operations[0].as_str() != Some("verify") {
            return Err(VerificationError::InvalidKeyRegistry(
                "JWK key_ops must be omitted or exactly [verify]".into(),
            ));
        }
    }
    if let Some(declared) = object.get("alg") {
        let expected = match algorithm {
            JwsAlgorithm::ES256 => "ES256",
            JwsAlgorithm::EdDSA => "EdDSA",
        };
        if declared.as_str() != Some(expected) {
            return Err(VerificationError::InvalidKeyRegistry(
                "JWK alg does not match registry algorithm".into(),
            ));
        }
    }
    match algorithm {
        JwsAlgorithm::ES256 => {
            if object.get("kty").and_then(Value::as_str) != Some("EC")
                || object.get("crv").and_then(Value::as_str) != Some("P-256")
            {
                return Err(VerificationError::InvalidKeyRegistry(
                    "ES256 requires an EC P-256 JWK".into(),
                ));
            }
            let x = decode_jwk_coordinate(object.get("x"), 32)?;
            let y = decode_jwk_coordinate(object.get("y"), 32)?;
            let mut sec1 = Vec::with_capacity(65);
            sec1.push(4);
            sec1.extend(x);
            sec1.extend(y);
            P256VerifyingKey::from_sec1_bytes(&sec1)
                .map(PublicKey::P256)
                .map_err(|_| VerificationError::InvalidKeyRegistry("invalid P-256 point".into()))
        }
        JwsAlgorithm::EdDSA => {
            if object.get("kty").and_then(Value::as_str) != Some("OKP")
                || object.get("crv").and_then(Value::as_str) != Some("Ed25519")
            {
                return Err(VerificationError::InvalidKeyRegistry(
                    "EdDSA requires an OKP Ed25519 JWK".into(),
                ));
            }
            let x: [u8; 32] = decode_jwk_coordinate(object.get("x"), 32)?
                .try_into()
                .map_err(|_| VerificationError::InvalidKeyRegistry("invalid Ed25519 x".into()))?;
            Ed25519VerifyingKey::from_bytes(&x)
                .map(PublicKey::Ed25519)
                .map_err(|_| VerificationError::InvalidKeyRegistry("invalid Ed25519 key".into()))
        }
    }
}

fn decode_jwk_coordinate(
    value: Option<&Value>,
    length: usize,
) -> Result<Vec<u8>, VerificationError> {
    let encoded = value
        .and_then(Value::as_str)
        .ok_or_else(|| VerificationError::InvalidKeyRegistry("JWK coordinate is missing".into()))?;
    let decoded = decode_base64url(
        encoded,
        VerificationError::InvalidKeyRegistry("JWK coordinate is not canonical base64url".into()),
    )?;
    if decoded.len() != length {
        return Err(VerificationError::InvalidKeyRegistry(
            "JWK coordinate has the wrong length".into(),
        ));
    }
    Ok(decoded)
}

fn decode_base64url(value: &str, error: VerificationError) -> Result<Vec<u8>, VerificationError> {
    if value.contains('=') {
        return Err(error);
    }
    let decoded = match URL_SAFE_NO_PAD.decode(value) {
        Ok(decoded) => decoded,
        Err(_) => return Err(error),
    };
    if URL_SAFE_NO_PAD.encode(&decoded) != value {
        return Err(error);
    }
    Ok(decoded)
}

fn is_sha256_digest(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value.as_bytes()[7..]
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

pub fn is_protocol_identifier(value: &str) -> bool {
    let bytes = value.as_bytes();
    if !(3..=128).contains(&bytes.len()) || !bytes[0].is_ascii_lowercase() {
        return false;
    }
    let mut index = 1;
    while index < bytes.len()
        && (bytes[index].is_ascii_lowercase() || bytes[index].is_ascii_digit())
    {
        index += 1;
    }
    let mut groups = 0;
    while index < bytes.len() {
        if !matches!(bytes[index], b'_' | b':' | b'-') {
            return false;
        }
        index += 1;
        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_alphanumeric() {
            index += 1;
        }
        if index == start {
            return false;
        }
        groups += 1;
    }
    groups > 0
}

pub fn is_rfc3339_utc_whole_seconds(value: &str) -> bool {
    parse_rfc3339_utc_whole_seconds_value(value).is_some()
}

pub fn canonicalize_jcs(value: &Value) -> Result<Vec<u8>, VerificationError> {
    Ok(serde_json_canonicalizer::to_vec(value)?)
}

pub fn digest_structured(
    profile: &str,
    value: &Value,
    wire_version: &str,
) -> Result<String, VerificationError> {
    validate_frame_component(profile, "profile")?;
    validate_frame_component(wire_version, "wire_version")?;

    let canonical = canonicalize_jcs(value)?;
    let mut hasher = Sha256::new();
    hasher.update(b"openant-commerce\0");
    hasher.update(wire_version.as_bytes());
    hasher.update([0]);
    hasher.update(profile.as_bytes());
    hasher.update([0]);
    hasher.update(canonical);
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn validate_frame_component(value: &str, name: &'static str) -> Result<(), VerificationError> {
    if value.is_empty() || value.as_bytes().contains(&0) {
        return Err(VerificationError::InvalidFrameComponent(name));
    }
    Ok(())
}

#[cfg(test)]
mod live_time_tests {
    use super::*;

    #[test]
    fn eip3009_valid_before_is_an_exclusive_live_boundary() {
        let vector: Value =
            serde_json::from_str(include_str!("../test-vectors/eip712-v1.json")).unwrap();
        let claims: WalletAuthorizationProofClaims =
            serde_json::from_value(vector["walletProofClaims"].clone()).unwrap();
        let envelope: SignatureEnvelope =
            serde_json::from_value(vector["envelope"].clone()).unwrap();
        let claimed_claims_digest = vector["claimsDigest"].as_str().unwrap();
        let context = WalletVerificationContext {
            wallet_proof_claims: &claims,
            claimed_claims_digest,
            wire_version: "0.1",
        };
        let expires_at = parse_rfc3339_utc_whole_seconds(&claims.expires_at).unwrap();

        assert_eq!(
            verify_eip712_wallet_observed_at(
                &envelope,
                &vector["typedData"],
                &context,
                expires_at,
            )
            .unwrap_err()
            .code(),
            VerificationErrorCode::AuthorizationTimeInvalid
        );
    }
}
