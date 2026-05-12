# with-breeze

An example app that integrates [ZeroXKey](https://0xkey.com) with [Breeze](https://breeze.baby) to demonstrate Solana-based USDC staking and yield management directly from a ZeroXKey-managed wallet.

This project shows how to:

- Authenticate and manage Solana wallets using `@0xkey-io/react-wallet-kit`
- Sign Solana transactions using `@0xkey-io/solana`
- Deposit and withdraw USDC via the Breeze API
- Fetch user balances and yield performance securely via server actions

---

## Features

- **Login with ZeroXKey** → authenticate and load available Solana wallets
- **Select wallet account** → choose which account to use for staking
- **Deposit & Withdraw** → perform USDC staking and redemption transactions
- **Transaction signing** → handled securely by `ZeroXKeySigner`
- **Private API calls** → Breeze API key is handled only on the server
- **Status updates** → real-time modal feedback with clickable Solscan transaction links

---

## Tech Stack

- [Next.js](https://nextjs.org/) (App Router, Client Components, Server Actions)
- [@0xkey-io/react-wallet-kit](https://www.npmjs.com/package/@0xkey-io/react-wallet-kit)
- [@0xkey-io/solana](https://www.npmjs.com/package/@0xkey-io/solana)
- [@solana/web3.js](https://solana-labs.github.io/solana-web3.js/)
- [@breezebaby/breeze-sdk](https://www.npmjs.com/package/@breezebaby/breeze-sdk)

---

## Getting Started

1. **Install dependencies**

   ```bash
   pnpm install
   # or
   npm install
   ```

2. **Set environment variables**  
   Create a `.env.local` file with:

   ```env
   NEXT_PUBLIC_ORGANIZATION_ID="<ZeroXKey organization ID>"
   BREEZE_API_KEY="<Breeze API key>"
   NEXT_PUBLIC_FUND_ID="<Breeze Fund ID>"
   NEXT_PUBLIC_AUTH_PROXY_ID="<ZeroXKey Auth Proxy ID>"
   ```

3. **Run the app**

   ```bash
   pnpm dev
   # or
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) and log in with ZeroXKey.
   - Select a Solana wallet account
   - Deposit or withdraw 1 USDC via Breeze
   - View balances and yield in real time
   - Check transaction confirmations on [Solscan](https://solscan.io)

---

## Security Notes

- The Breeze API key (`BREEZE_API_KEY`) is **never exposed to the client** — all API calls are routed through a secure **Next.js Server Action** in `app/actions/breeze.ts`.
- The client interacts only with safe endpoints and signed transactions.
- Always keep your `.env.local` file out of version control.

---

## Folder Structure

```
with-breeze/
├── actions/
│   └── breeze.ts           # Server-side Breeze integration
├── app/
│   ├── page.tsx             # Entry point for the app
├── package.json
├── tsconfig.json
├── .env.local.example
└── README.md
```

---

## Example Flow

1. **User logs in with ZeroXKey** → loads Solana wallets
2. **Select wallet** → picks one associated with their org
3. **Deposit 1 USDC** → transaction built by Breeze, signed by ZeroXKey
4. **Confirm on-chain** → modal shows real-time confirmation
5. **Track yield** → app fetches updated balance and APY from Breeze
6. **View on Solscan** → click transaction hash to verify on-chain

---
