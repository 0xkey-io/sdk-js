# 0xkey Pay Playground

This example demonstrates the 0xkey Pay x402 flow on Base Sepolia with a local
Orchestrator and a 0xkey Company Wallet signer:

- `@0xkey-io/pay` builds x402 v2 EIP-3009 payment payloads.
- `0xkey Orchestrator` verifies and settles through an `x402-rs` sidecar.
- Base Sepolia USDC moves on-chain with the smallest smoke amount: `1` atomic USDC (`0.000001 USDC`).
- The playground shows balances, tx hash, and merchant payment records via the Pay HTTP API.

## Overview

The home page is a local interactive playground for the recommended product
path:

- **Company Wallet**: a server-side 0xkey API key signs EIP-3009 typed data
  with a company wallet through `@0xkey-io/sdk-server` + `@0xkey-io/viem`,
  then sends the x402 v2 payload through the local Orchestrator settlement
  flow.

Local key signing still exists only as a hidden API/CLI debug path. It is not
shown in the page because it does not match the Company Wallet product story.

It has four panels:

- **Seller Panel**: network, asset, `payTo`, price, and resource.
- **Buyer Panel**: buyer, facilitator signer, and scenario actions.
- **Settlement Panel**: USDC balances, tx hash, and Basescan link.
- **Debug Panel**: latest `/verify` / `/settle` response and merchant payment records.

Covered scenarios:

- Successful tiny settlement.
- Invalid EIP-712 domain (`USD Coin` instead of `USDC`).
- Repeat nonce / idempotent settle.
- Excess amount / insufficient balance.

## How It Works

### 1. Orchestrator Flow

The playground API routes call a local Orchestrator / Facilitator facade at
`http://localhost:8090`. The Orchestrator delegates settlement to the local
`x402-rs` sidecar.

```text
Playground UI
  -> /api/playground/verify or /api/playground/settle
  -> 0xkey Orchestrator
  -> x402-rs sidecar
  -> Base Sepolia USDC
  -> merchant payments API
```

### 2. Company Wallet Signing

The playground signs server-side with a 0xkey company wallet:

```text
API key stamper
  -> ZeroXKeyServerClient
  -> createAccount(client, organizationId, signWith)
  -> account.signTypedData(EIP-3009)
  -> /api/playground/settle
  -> Orchestrator /verify + /settle
```

### 3. Smoke Script

For a CLI version of the same flow, use:

```bash
cd /Users/torben/codes/0xkey/repos/services
scripts/x402-smoke-base-sepolia.sh
```

The detailed runbook lives in `docs/strategy/pay/base-sepolia-settlement-smoke.md`.

## Running The App

Start local services first:

```bash
cd /Users/torben/codes/0xkey/repos/services

docker compose --env-file .env.x402.local \
  -f docker-compose.dev.yml \
  up -d postgres redis x402-rs-facilitator

make db-migrate

ORG_ID=$(
  PGPASSWORD=postgres psql -h localhost -U postgres -d 0xkey \
    -tAc "SELECT id FROM organization_aggregates LIMIT 1"
)

DATABASE_URL=postgres://postgres:postgres@localhost:5432/0xkey \
DEFAULT_ORGANIZATION_ID="$ORG_ID" \
FACILITATOR_PROVIDER=x402-rs \
X402_RS_URL=http://localhost:8088 \
LISTEN_ADDR=0.0.0.0:8090 \
cargo run --bin facilitator
```

Configure the example app for fully local testing:

```bash
cd /Users/torben/codes/0xkey/repos/sdk-js/examples/with-x402
cp .env.local.example .env.local
```

Fill these local Company Wallet values:

```bash
PAY_ORGANIZATION_ID=<local-org-id-for-pay-records>
ZEROXKEY_ORGANIZATION_ID=<local-company-wallet-org-id>
ZEROXKEY_API_PUBLIC_KEY=<local-api-public-key>
ZEROXKEY_API_PRIVATE_KEY=<local-api-private-key>
ZEROXKEY_SIGN_WITH=<local-wallet-account-address-or-private-key-id>
ZEROXKEY_ETHEREUM_ADDRESS=<local-wallet-account-address-if-sign-with-is-privateKeyId>
ZEROXKEY_API_BASE_URL=http://localhost:8080
```

For staging Company Wallet signing, keep the Orchestrator local but point only
wallet/signing requests at staging:

```bash
cd /Users/torben/codes/0xkey/repos/sdk-js/examples/with-x402
cp .env.staging.example .env.staging.local
cp .env.staging.local .env.local
```

The important hybrid endpoints are:

```bash
NEXT_PUBLIC_FACILITATOR_URL=http://localhost:8090
ZEROXKEY_API_BASE_URL=https://api.staging.0xkey.io
```

`ZEROXKEY_ORGANIZATION_ID` is the staging organization used for wallet signing.
`PAY_ORGANIZATION_ID` is only for the local Orchestrator's payment records and
must exist in the local services database.

Keep real staging secrets in `.env.staging.local` rather than committing them to
`.env.staging.example`.

To create a staging Company Wallet account from the API key, temporarily set:

```bash
ALLOW_COMPANY_WALLET_CREATE=true
```

Then, with the local Next app running, call:

```bash
curl -sS -X POST http://localhost:3000/api/playground/company-wallet/create
```

The response includes `ZEROXKEY_SIGN_WITH` / `ZEROXKEY_ETHEREUM_ADDRESS` values
to copy into `.env.local`. Set `ALLOW_COMPANY_WALLET_CREATE=false` again after
the one-shot creation.

Start the Next app:

```bash
cd /Users/torben/codes/0xkey/repos/sdk-js
pnpm --filter with-x402 dev
```

Open `http://localhost:3000`.

If the full local 0xkey stack is already using port `3000` for the Dashboard,
run the playground on another port:

```bash
pnpm --filter with-x402 exec next dev -p 3400
```

## Safety Notes

- Do not paste private keys into chat, docs, or committed files.
- Keep `.env.local` and `.env.x402.local` local-only.
- Keep `.env.staging.local` local-only when staging API keys are involved.
- Use fresh Base Sepolia test wallets only.
- The page is intentionally Company Wallet only. Local key smoke is reserved for
  CLI/API debugging.
- Default amount is `1` atomic USDC to avoid accidental test token drain.
