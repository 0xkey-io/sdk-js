# with-jupiter

An example app that integrates [ZeroXKey](https://0xkey.com) with [Jupiter’s Ultra Swap](https://station.jup.ag/docs/apis/ultra-api) to demonstrate Solana token swaps directly from a ZeroXKey-managed wallet.

This project shows how to:

- Authenticate and manage Solana wallets using `@0xkey-io/react-wallet-kit`
- Sign Solana transactions using `@0xkey-io/solana`
- Create and execute Jupiter Ultra orders with a connected wallet

---

## Features

- **Login with ZeroXKey** → authenticate and load available wallets
- **Select wallet account** → choose which account to use for swaps
- **Swap tokens** → trigger USDC → SOL or SOL → USDC swaps via Jupiter Ultra
- **Transaction signing** → handled by ZeroXKey signer (`ZeroXKeySigner`)
- **Status updates** → real-time UI updates with clickable Solscan links

---

## Tech Stack

- [Next.js](https://nextjs.org/) (App Router, Client Components)
- [@0xkey-io/react-wallet-kit](https://www.npmjs.com/package/@0xkey-io/react-wallet-kit)
- [@0xkey-io/solana](https://www.npmjs.com/package/@0xkey-io/solana)
- [@solana/web3.js](https://solana-labs.github.io/solana-web3.js/)
- Jupiter Ultra API

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
    NEXT_PUBLIC_BASE_URL="https://api.0xkey.com"
    NEXT_PUBLIC_ORGANIZATION_ID="1875b49b-22ad-42c6-949f-04d5dd03ee3a"
    NEXT_PUBLIC_AUTH_PROXY_URL="https://authproxy.0xkey.com/"
    NEXT_PUBLIC_AUTH_PROXY_ID="a70d82ef-4373-467a-a189-9be44629799b"

   ```

3. **Run the app**

   ```bash
   pnpm dev
   # or
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) and log in with ZeroXKey.
   - Select a wallet account
   - Try swapping USDC ↔ SOL
   - Check the transaction on [Solscan](https://solscan.io)
