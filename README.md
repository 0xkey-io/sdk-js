# ZeroXKey SDK

[![js-build](https://github.com/0xkey-io/sdk-js/actions/workflows/js-build.yml/badge.svg)](https://github.com/0xkey-io/sdk-js/actions/workflows/js-build.yml)

## Overview

The ZeroXKey SDK includes functionality to interact with ZeroXKey in various contexts and ecosystems. It consists of three main NPM package groups.

- [Primary ZeroXKey SDK Packages](#primary-zeroxkey-sdk-packages) — main functionality for building ZeroXKey-powered applications across web and mobile environments
- [Chain/Ecosystem-Specific Signing Packages](#chainecosystem-specific-signing-sdk-packages) — signers with support for specific ecosystems, built on top of the primary SDK
- [Advanced Functionality SDK Packages](#advanced-functionality-sdk-packages) — lower-level stamping and encryption primitives

## Primary ZeroXKey SDK Packages

The following packages expose the main functionality required to build ZeroXKey-powered applications. Each package provides client classes and utilities for authenticating requests to the ZeroXKey API in browser, React, React Native, or server environments.

| Package                                                                  | NPM                                                                                                                                                       | Description                                                                                                                                                                    | Changelog                                                   | Docs                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------- |
| [`@0xkey-io/react-wallet-kit`](/packages/react-wallet-kit)               | [![npm](https://img.shields.io/npm/v/@0xkey-io/react-wallet-kit?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/react-wallet-kit)               | Easiest way to integrate ZeroXKey Embedded Wallets into React apps. Provides UI components and hooks, with optional Auth Proxy support.                                        | [CHANGELOG](/packages/react-wallet-kit/CHANGELOG.md)        | [Docs](https://docs.0xkey.com/sdks/react)                 |
| [`@0xkey-io/react-native-wallet-kit`](/packages/react-native-wallet-kit) | [![npm](https://img.shields.io/npm/v/@0xkey-io/react-native-wallet-kit?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/react-native-wallet-kit) | Easiest way to integrate ZeroXKey Embedded Wallets into React Native apps. Provides hooks and utilities for mobile wallet experiences.                                         | [CHANGELOG](/packages/react-native-wallet-kit/CHANGELOG.md) | [Docs](https://docs.0xkey.com/sdks/react-native/overview) |
| [`@0xkey-io/core`](/packages/core)                                       | [![npm](https://img.shields.io/npm/v/@0xkey-io/core?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/core)                                       | Low-level TypeScript client with API primitives, session management, and stampers. For frameworks without an official wallet kit (Angular, Vue, Svelte) or advanced use cases. | [CHANGELOG](/packages/core/CHANGELOG.md)                    | [Docs](https://docs.0xkey.com/sdks/typescript-frontend)   |
| [`@0xkey-io/sdk-server`](/packages/sdk-server)                           | [![npm](https://img.shields.io/npm/v/@0xkey-io/sdk-server?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/sdk-server)                           | Server-side API client and proxies for authenticating users, managing sessions, and performing organizational operations.                                                      | [CHANGELOG](/packages/sdk-server/CHANGELOG.md)              | [Docs](https://docs.0xkey.com/sdks/javascript-server)     |

## Chain/Ecosystem-Specific Signing SDK Packages

Ecosystem-specific signers that extend the primary SDK with chain-aware signing and transaction support.

| Package                                                      | NPM                                                                                                                                           | Description                                                        | Changelog                                             |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| [`@0xkey-io/ethers`](/packages/ethers)                       | [![npm](https://img.shields.io/npm/v/@0xkey-io/ethers?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/ethers)                       | ZeroXKey Signer for Ethers                                         | [CHANGELOG](/packages/ethers/CHANGELOG.md)            |
| [`@0xkey-io/viem`](/packages/viem)                           | [![npm](https://img.shields.io/npm/v/@0xkey-io/viem?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/viem)                           | ZeroXKey Signer for Viem                                           | [CHANGELOG](/packages/viem/CHANGELOG.md)              |
| [`@0xkey-io/cosmjs`](/packages/cosmjs)                       | [![npm](https://img.shields.io/npm/v/@0xkey-io/cosmjs?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/cosmjs)                       | ZeroXKey Signer for CosmJS                                         | [CHANGELOG](/packages/cosmjs/CHANGELOG.md)            |
| [`@0xkey-io/solana`](/packages/solana)                       | [![npm](https://img.shields.io/npm/v/@0xkey-io/solana?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/solana)                       | ZeroXKey Signer for Solana                                         | [CHANGELOG](/packages/solana/CHANGELOG.md)            |
| [`@0xkey-io/eip-1193-provider`](/packages/eip-1193-provider) | [![npm](https://img.shields.io/npm/v/@0xkey-io/eip-1193-provider?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/eip-1193-provider) | ZeroXKey-compatible EIP-1193 Provider                              | [CHANGELOG](/packages/eip-1193-provider/CHANGELOG.md) |
| [`@0xkey-io/gas-station`](/packages/gas-station)             | [![npm](https://img.shields.io/npm/v/@0xkey-io/gas-station?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/gas-station)             | Gasless transactions using EIP-7702 and ZeroXKey wallet management | [CHANGELOG](/packages/gas-station/CHANGELOG.md)       |

## Advanced Functionality SDK Packages

Lower-level stamping and encryption libraries for specialized use cases. Most applications should use the [Primary SDK Packages](#primary-zeroxkey-sdk-packages) instead.

### Request Stamping

| Package                                                                                | NPM                                                                                                                                                                     | Description                                            | Changelog                                                          | Docs                                                                                         |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| [`@0xkey-io/http`](/packages/http)                                                     | [![npm](https://img.shields.io/npm/v/@0xkey-io/http?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/http)                                                     | Fully typed HTTP client for ZeroXKey API               | [CHANGELOG](/packages/http/CHANGELOG.md)                           | [Docs](https://docs.0xkey.com/sdks/advanced/0xkey-client)                                    |
| [`@0xkey-io/api-key-stamper`](/packages/api-key-stamper)                               | [![npm](https://img.shields.io/npm/v/@0xkey-io/api-key-stamper?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/api-key-stamper)                               | API key signatures over ZeroXKey requests              | [CHANGELOG](/packages/api-key-stamper/CHANGELOG.md)                | [Docs](https://docs.0xkey.com/sdks/advanced/api-key-stamper)                                 |
| [`@0xkey-io/iframe-stamper`](/packages/iframe-stamper)                                 | [![npm](https://img.shields.io/npm/v/@0xkey-io/iframe-stamper?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/iframe-stamper)                                 | API key signatures within iframe contexts              | [CHANGELOG](/packages/iframe-stamper/CHANGELOG.md)                 | [Docs](https://docs.0xkey.com/sdks/advanced/iframe-stamper)                                  |
| [`@0xkey-io/webauthn-stamper`](/packages/webauthn-stamper)                             | [![npm](https://img.shields.io/npm/v/@0xkey-io/webauthn-stamper?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/webauthn-stamper)                             | WebAuthn signatures over ZeroXKey requests             | [CHANGELOG](/packages/webauthn-stamper/CHANGELOG.md)               | [Docs](https://docs.0xkey.com/sdks/advanced/webauthn-stamper)                                |
| [`@0xkey-io/wallet-stamper`](/packages/wallet-stamper)                                 | [![npm](https://img.shields.io/npm/v/@0xkey-io/wallet-stamper?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/wallet-stamper)                                 | Wallet signatures over ZeroXKey requests               | [CHANGELOG](/packages/wallet-stamper/CHANGELOG.md)                 | [Docs](https://docs.0xkey.com/sdks/advanced/wallet-stamper)                                  |
| [`@0xkey-io/react-native-passkey-stamper`](/packages/react-native-passkey-stamper)     | [![npm](https://img.shields.io/npm/v/@0xkey-io/react-native-passkey-stamper?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/react-native-passkey-stamper)     | Passkey signatures in React Native                     | [CHANGELOG](/packages/react-native-passkey-stamper/CHANGELOG.md)   | [Docs](https://docs.0xkey.com/sdks/react-native)                                             |
| [`@0xkey-io/indexed-db-stamper`](/packages/indexed-db-stamper)                         | [![npm](https://img.shields.io/npm/v/@0xkey-io/indexed-db-stamper?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/indexed-db-stamper)                         | Request stamping with P-256 keypair in IndexedDB       | [CHANGELOG](/packages/indexed-db-stamper/CHANGELOG.md)             | [Docs](https://docs.0xkey.com/authentication/sessions#indexeddb-web-only-:)                  |
| [`@0xkey-io/telegram-cloud-storage-stamper`](/packages/telegram-cloud-storage-stamper) | [![npm](https://img.shields.io/npm/v/@0xkey-io/telegram-cloud-storage-stamper?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/telegram-cloud-storage-stamper) | Stamping with API key stored in Telegram Cloud Storage | [CHANGELOG](/packages/telegram-cloud-storage-stamper/CHANGELOG.md) | [Docs](https://github.com/0xkey-io/sdk-js/tree/main/packages/telegram-cloud-storage-stamper) |

### Utilities

| Package                                    | NPM                                                                                                                         | Description                                                       | Changelog                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| [`@0xkey-io/encoding`](/packages/encoding) | [![npm](https://img.shields.io/npm/v/@0xkey-io/encoding?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/encoding) | Encoding and decoding utilities                                   | [CHANGELOG](/packages/encoding/CHANGELOG.md) |
| [`@0xkey-io/crypto`](/packages/crypto)     | [![npm](https://img.shields.io/npm/v/@0xkey-io/crypto?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/crypto)     | Cryptographic utilities for P256 keys, encryption, and decryption | [CHANGELOG](/packages/crypto/CHANGELOG.md)   |

## Code Examples

See the [`examples/`](/examples) directory for a full list. Highlights:

| Example                                                                   | Description                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`react-wallet-kit`](/examples/react-wallet-kit/)                         | React integration using `@0xkey-io/react-wallet-kit`               |
| [`with-react-native-wallet-kit`](/examples/with-react-native-wallet-kit/) | React Native integration using `@0xkey-io/react-native-wallet-kit` |
| [`kitchen-sink`](/examples/kitchen-sink/)                                 | Comprehensive example covering multiple SDK features               |
| [`oauth`](/examples/oauth/)                                               | OAuth authentication flow                                          |
| [`with-sdk-server`](/examples/with-sdk-server/)                           | Server-side SDK integration                                        |
| [`deployer`](/examples/deployer/)                                         | Compile and deploy a smart contract                                |
| [`email-auth-local-storage`](/examples/email-auth-local-storage/)         | Email auth flow with locally stored target embedded key            |
| [`with-ethers`](/examples/with-ethers/)                                   | Sign and broadcast a transaction using Ethers                      |
| [`with-viem`](/examples/with-viem/)                                       | Sign and broadcast a transaction using Viem                        |
| [`with-cosmjs`](/examples/with-cosmjs/)                                   | Sign and broadcast a transaction on Celestia testnet               |
| [`with-solana`](/examples/with-solana/)                                   | Sign and broadcast a transaction on Solana devnet                  |
| [`with-bitcoin`](/examples/with-bitcoin/)                                 | Create, sign, and broadcast a BTC transaction                      |
| [`with-biconomy-aa`](/examples/with-biconomy-aa/)                         | Account abstraction with Biconomy Nexus                            |
| [`with-zerodev-aa`](/examples/with-zerodev-aa/)                           | Account abstraction with ZeroDev kernel                            |
| [`with-gnosis`](/examples/with-gnosis/)                                   | Configure and execute a Gnosis Safe transaction                    |
| [`gas-station`](/examples/gas-station/)                                   | Gasless transactions with EIP-7702                                 |
| [`with-eip-1193-provider`](/examples/with-eip-1193-provider/)             | EIP-1193 provider integration                                      |
| [`with-wallet-stamper`](/examples/with-wallet-stamper/)                   | Wallet stamper integration                                         |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.
