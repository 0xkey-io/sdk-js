# Standalone Pay v1 UAT merchant

This staging-only harness exposes one paid resource through the released
`@0xkey-io/pay` seller core. The same `GET /paid/ping` route advertises x402 v2
`exact` and MPP `evm/charge`, then settles through the 0xkey staging Pay
gateway before returning the merchant response.

The acceptance price is fixed at `0.001 USDC` on Base Sepolia canonical USDC.
The harness is not a production merchant and must never be pointed at Base
mainnet.

## Safety boundary

- Use a rotated staging organization API key. Never paste the private half in
  chat, commit it, or put it in command history.
- Store the key and `MPP_SECRET_KEY` in a local secret manager or an ignored
  environment file with restrictive permissions.
- Use different accounts for payer, merchant `payTo`, and facilitator relayer.
- The server logs method, path, status, and readiness only. It does not log
  request headers, payment credentials, API keys, or receipts.
- Each real x402 or MPP payment requires a fresh operator confirmation of
  protocol, payer, payee, amount, asset, network, and endpoint.

## Challenge-only smoke

This does not sign or settle a payment:

```bash
pnpm --filter @0xkey-io/pay build
pnpm --filter pay-v1-uat smoke
```

It checks that the route returns both standard challenges and that the x402
challenge is Base Sepolia, canonical USDC, exact `1000` atomic units, and the
configured `payTo`.

## Run the merchant

Copy `.env.example` to a git-ignored file, inject the rotated credentials into
the shell without printing them, then run:

```bash
pnpm --filter @0xkey-io/pay build
pnpm --filter pay-v1-uat start
```

Endpoints:

- `GET http://127.0.0.1:3402/health`
- `GET http://127.0.0.1:3402/paid/ping`

An unauthenticated request to `/paid/ping` must return 402 with both
`PAYMENT-REQUIRED` and `WWW-Authenticate: Payment ...`. A paid response is
returned only after the staging facilitator reports a confirmed settlement.
