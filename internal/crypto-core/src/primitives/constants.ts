export const SUITE_ID_1 = new Uint8Array([75, 69, 77, 0, 16]); //KEM suite ID
export const SUITE_ID_2 = new Uint8Array([72, 80, 75, 69, 0, 16, 0, 1, 0, 2]); //HPKE suite ID
export const HPKE_VERSION = new Uint8Array([72, 80, 75, 69, 45, 118, 49]); //HPKE-v1
export const LABEL_SECRET = new Uint8Array([115, 101, 99, 114, 101, 116]); //secret
export const LABEL_EAE_PRK = new Uint8Array([101, 97, 101, 95, 112, 114, 107]); //eae_prk
export const LABEL_SHARED_SECRET = new Uint8Array([
  115, 104, 97, 114, 101, 100, 95, 115, 101, 99, 114, 101, 116,
]); //shared_secret
export const AES_KEY_INFO = new Uint8Array([
  0, 32, 72, 80, 75, 69, 45, 118, 49, 72, 80, 75, 69, 0, 16, 0, 1, 0, 2, 107,
  101, 121, 0, 143, 195, 174, 184, 50, 73, 10, 75, 90, 179, 228, 32, 35, 40,
  125, 178, 154, 31, 75, 199, 194, 34, 192, 223, 34, 135, 39, 183, 10, 64, 33,
  18, 47, 63, 4, 233, 32, 108, 209, 36, 19, 80, 53, 41, 180, 122, 198, 166, 48,
  185, 46, 196, 207, 125, 35, 69, 8, 208, 175, 151, 113, 201, 158, 80,
]); //key
export const IV_INFO = new Uint8Array([
  0, 12, 72, 80, 75, 69, 45, 118, 49, 72, 80, 75, 69, 0, 16, 0, 1, 0, 2, 98, 97,
  115, 101, 95, 110, 111, 110, 99, 101, 0, 143, 195, 174, 184, 50, 73, 10, 75,
  90, 179, 228, 32, 35, 40, 125, 178, 154, 31, 75, 199, 194, 34, 192, 223, 34,
  135, 39, 183, 10, 64, 33, 18, 47, 63, 4, 233, 32, 108, 209, 36, 19, 80, 53,
  41, 180, 122, 198, 166, 48, 185, 46, 196, 207, 125, 35, 69, 8, 208, 175, 151,
  113, 201, 158, 80,
]); //base_nonce
export const QUORUM_ENCRYPT_NONCE_LENGTH_BYTES = 12;
export const UNCOMPRESSED_PUB_KEY_LENGTH_BYTES = 65;
export const QOS_ENCRYPTION_HMAC_MESSAGE = new Uint8Array([
  113, 111, 115, 95, 101, 110, 99, 114, 121, 112, 116, 105, 111, 110, 95, 104,
  109, 97, 99, 95, 109, 101, 115, 115, 97, 103, 101,
]); // Used for encrypting messages to quorum keys; this must match the enclave domain separator.
export const PRODUCTION_SIGNER_SIGN_PUBLIC_KEY =
  "046d10ba0b618a5fd338a39e95e0236bb50fa323804952da886aa3768cd6b603747d606778096d5eb24644600f6f7d4a634a93043a8a5db99081068e1e03a9f201";

export const PRODUCTION_NOTARIZER_SIGN_PUBLIC_KEY =
  "046d10ba0b618a5fd338a39e95e0236bb50fa323804952da886aa3768cd6b603747d606778096d5eb24644600f6f7d4a634a93043a8a5db99081068e1e03a9f201";

export const PRODUCTION_TLS_FETCHER_ENCRYPT_PUBLIC_KEY =
  "0438c11ab9353df275dd2f3b99a47c64fe37c820775e352cb2746221d9eb458bc513aedae91a662d3a57de88d708c04dd494fc99dfe3ea91b6b4e9fcbca12e78e6";

export const PRODUCTION_ON_RAMP_CREDENTIALS_ENCRYPTION_PUBLIC_KEY =
  "02336ebd7e929ef64b87c776b72540255b4c7b41579a24b1e68fb060daa873f9f6";

// Quorum trust anchor for boot proof verification (verifyBootProof):
// the manifest-set members + threshold + quorum key that approved the
// currently-deployed 0xkey production manifests. Pinned from the quorum
// ceremony's signed manifest — see
// repos/enclave-releases/releases/2026.6.15/signer/manifest.json (all 5
// enclave apps in a given release share the same manifestSet/quorumKey).
// Update this pin whenever quorum membership changes (new ceremony that
// rotates manifest-set members, not routine per-app manifest updates).
export const PRODUCTION_QUORUM_MANIFEST_SET_THRESHOLD = 4;

export const PRODUCTION_QUORUM_MANIFEST_SET_MEMBERS: ReadonlyArray<{
  alias: string;
  pubKeyHex: string;
}> = [
  {
    alias: "manifest-bin",
    pubKeyHex:
      "04fe1eb9a5b64783555b8403218dc1b0d434967f7eb87cb3f991bc8ef0502137f8c9e22d26aaa213dd2e0fbe639826c9efb9ee6ff4da98c4f7277076cf8162b81e0434675448568d9d0686b9e2b7e7e7b0a769486defa97d3cb76841e350f3345231eb194fd1a2373f4a5d01c2d3d118f599817774f945d9178d8b04c09d6cfb7c8d",
  },
  {
    alias: "manifest-chouowen",
    pubKeyHex:
      "044485e6df0687e2b5943a2375519d4c2cc5aa7b58aa741220f89c71ccee83b11f61b0ec6eab1645129a090b585631770f8614c49287ae86ce5599a2e60805acd8046b6ffe8e3561dbec8a65f7dce5f8ef0dd4997a59ef43d1594557d4236b84aef6483b26e4ed37ef25be093fcea677a7ea24d80f3a765a22680963a30aded07ccf",
  },
  {
    alias: "manifest-harry",
    pubKeyHex:
      "047f6deb6d265190250ed87bcdcb833e6aaabac0bce524a259923b4e92bbe62b59e225983cae6262e995c54102ffaa3f02d2ccf24f06f4b15926017c24e44821f3041ce7a7f2a90a8274e753961762b11d3359ad2471ff45e6848880fc15454170475d123551c235dc64ca673f4a63b1c5090a349766286a6b94d72b9493c5d81cc3",
  },
  {
    alias: "manifest-hot",
    pubKeyHex:
      "04ad5dc00c58a6941b7de7a70f2dd630ff88234a3fa6487c0ce4c044151fe00af5fdf3924fa37cffdcc27c6b51d20dcefedea9b46ab604dc997f118c92501ef64904c655cd4adfefb2d45d5fd34021e8781e29a8d2849cd3312ec614f88168e44e8d1f3faa679ff362481cf5920dbb65cadbc18ebc49c1f2fceecef62dc27cc95590",
  },
  {
    alias: "manifest-j",
    pubKeyHex:
      "04fb76921adea0309731829c272f72c31f8d1f1585c31f3666bee0f529b43ffab82cb139f62450b566445158e0c20fefee3e896a66228f2a2f449ef4eee9abc7da049ada1c6e5f1633413e37433fdb3a76b28e39759ca0e73263c6eb01c98ccdbb26505eececc707e643231dbea6e33d242eb910d1ab3c7bcd3a3af8a1bc00c69b2f",
  },
  {
    alias: "manifest-jackson",
    pubKeyHex:
      "0484540286d53dc3d713cfd9738698ea08389cc7d0f4762e9ac3e101d21a00c684850d14bdaf18bccc7d20bf589556abc46b1bece2a083527dfa2f96ed3f0f9f5504a61a613bd933aaaf984ba48388c014d11df2a2ccecb15e0898b4a374e1da40533c414997dc7d58dcf516cb95c642c7d75cc95ceb5098956418b26c3db77783a6",
  },
  {
    alias: "manifest-kekos",
    pubKeyHex:
      "043503307a76874916d9371aed135ef5fd1500c041fda56c0799c05671003db48632a4a18e79fcaf18a83d63fe4ac89436d43f4c0291f0d19c04d5ebaf180ff7a1047651490c5c6a1a57c90d3d920f5bb29142cccaa73114b6bd5c23f59581fae858c9da021768bf47d3848bca154547e76a08cecc98f8d27034f3ec57a0b7fa51c9",
  },
  {
    alias: "manifest-leon",
    pubKeyHex:
      "04322d3f65af5cff22c95cfe2dd702ffdfcb1308f637f74e1273977131c60f1f24b296e558f8b3ccef27fda91466df0ba548ef9c1afbc0d73a7a707cd75e1d8569045cfb0bd4b0a5c33b6be87eb3aa2a0554920e26731701a7dfe59bb8abb579e78b51d4793e2ad2a7ac713cc05d86fe7b7358559033a4cf9d5d9f2efd2126e1d521",
  },
  {
    alias: "manifest-m",
    pubKeyHex:
      "04a494626f55b638fc37663f3ed76e167732453aa66043f3a0cc6f6af3ff8b7c2b229f4d8041f1c9bdeb62abd12d76e5d1d643ede33856d3329f414b8e2966db8c0454633c09cf0cd51f51a46c5392b505401cab570ae5381e0fdc85f862614cd9e24df1c9cf0d52b520d4703f5bca52d4ea1ab3658d9d8d1d12e8dc73b45281304e",
  },
  {
    alias: "manifest-torben",
    pubKeyHex:
      "04733f848b411c4afdba4e94d0d1cba9acf42ab122cf5e6fd9957380bb6d981f5b052083c8714171c644dae40c3c30eddc504f4717b4364bc3461e797cd09200c904b00e93e7938172b886433c31c618461e9a0b471b7ad37162e2dfdf946ea1f9540d05b0646223ed80f96809b23929d3bc4928d9a01ef551f432418d2a3b0ffaaf",
  },
];

export const PRODUCTION_QUORUM_KEY_HEX =
  "0438c11ab9353df275dd2f3b99a47c64fe37c820775e352cb2746221d9eb458bc513aedae91a662d3a57de88d708c04dd494fc99dfe3ea91b6b4e9fcbca12e78e6046d10ba0b618a5fd338a39e95e0236bb50fa323804952da886aa3768cd6b603747d606778096d5eb24644600f6f7d4a634a93043a8a5db99081068e1e03a9f201";

// Quorum trust anchor for the `staging-default` environment's boot proof
// verification. Pinned from the staging quorum ceremony's manifest-set —
// see `~/0xkey/keyops/staging-default/manifester1/shared/{manifest-set,
// quorum_key}.pub` on an operator machine (not committed to this repo,
// since it's operator key material, not code — these are just the public
// keys copied out of it). Cross-checked against the live staging signer's
// boot proof manifest (namespace "0xkey/signer") during the initial
// boot-proof-verification rollout. Update if staging's quorum membership
// ever changes (new ceremony rotating manifest-set members).
export const STAGING_QUORUM_MANIFEST_SET_THRESHOLD = 2;

export const STAGING_QUORUM_MANIFEST_SET_MEMBERS: ReadonlyArray<{
  alias: string;
  pubKeyHex: string;
}> = [
  {
    alias: "manifester1",
    pubKeyHex:
      "0485e2a53baa735645e72ba0ab5bc27cfbb1b900f07c416998c02ffdd35be185909e858e25d8cc3548464d2bae8d92d1b4b6a3358a904b8cd5a87d9590c4f9f3f8042beaf3fb2899250d17085782c7e82dc46da07b79cec41475ab20ea4e9f2ba94eac3f18ddb234cc7cda6ee54a71fb58ff3cc02e35f5d236444878d0d8ae7d5721",
  },
  {
    alias: "manifester2",
    pubKeyHex:
      "04ce62b47a52e265c2a4465ce8e34f451d465587586fd632b279ff00c7dd832f0bbd537edf9340723795847e21e706770d4d133c7cb1287b6a49778a07518af350042a26a0faec055587fe2e97386e13c537ba1a3434d2bd4ac7daf0097c571db274d1234a319875ddfbd99f157ff10ef1d15ffd0f5f619e3bc386ef6a555bd84434",
  },
  {
    alias: "manifester3",
    pubKeyHex:
      "043a3dffd396421c4835ce3ba629dd2c576f2a2beeebb6791536238537d6cb9ea2ce7df15c1a022ad7517fbab13f08748a1fda2b2c9c71741ce7a05ddeed94a1490460bcd41fadc768c9f60918d9184636d8507c0d1e174bbb54deebbcd510627e86d70e0d0f4856a82285fe8941e0b40578878f25c9903d8ef33d39ffa9fb98ee79",
  },
];

export const STAGING_QUORUM_KEY_HEX =
  "048a3d4a375c46f90285603033ef2cbc8093dd38173770ac9db1538ba573a5fbcf567a326624ce8a43d5a6598288b120c90bd9d78145c050db9cbb232a6690ef1b046f2e6d75c39167e1e23dce9f12920edbcf3e82dbf6f09e7acfaa8e00f9945e5bfe598439367c295bf05920edab68213b739a9eebd5f159397db29d3c50dd91a9";

// Pinned AWS Nitro Enclaves Root
export const AWS_ROOT_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIICETCCAZagAwIBAgIRAPkxdWgbkK/hHUbMtOTn+FYwCgYIKoZIzj0EAwMwSTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoMBkFtYXpvbjEMMAoGA1UECwwDQVdTMRswGQYD
VQQDDBJhd3Mubml0cm8tZW5jbGF2ZXMwHhcNMTkxMDI4MTMyODA1WhcNNDkxMDI4
MTQyODA1WjBJMQswCQYDVQQGEwJVUzEPMA0GA1UECgwGQW1hem9uMQwwCgYDVQQL
DANBV1MxGzAZBgNVBAMMEmF3cy5uaXRyby1lbmNsYXZlczB2MBAGByqGSM49AgEG
BSuBBAAiA2IABPwCVOumCMHzaHDimtqQvkY4MpJzbolL//Zy2YlES1BR5TSksfbb
48C8WBoyt7F2Bw7eEtaaP+ohG2bnUs990d0JX28TcPQXCEPZ3BABIeTPYwEoCWZE
h8l5YoQwTcU/9KNCMEAwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUkCW1DdkF
R+eWw5b6cp3PmanfS5YwDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMDA2kAMGYC
MQCjfy+Rocm9Xue4YnwWmNJVA44fA0P5W2OpYow9OYCVRaEevL8uO1XYru5xtMPW
rfMCMQCi85sWBbJwKKXdS6BptQFuZbT73o/gBh1qUxl/nNr12UO8Yfwr6wPLb+6N
IwLz3/Y=
-----END CERTIFICATE-----`;

// Official SHA-256 fingerprint
export const AWS_ROOT_CERT_SHA256 =
  "641A0321A3E244EFE456463195D606317ED7CDCC3C1756E09893F3C68F79BB5B";
