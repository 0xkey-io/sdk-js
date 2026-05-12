# Example: `eth-usdc-swap`

This example shows how to swap native ETH for USDC on **Base mainnet** using Uniswap’s Universal Router, built on top of [`ethers`](https://docs.ethers.org/v6/) and executed via ZeroXKey.

The script supports both **sponsored** and **non-sponsored** transactions.

---

## Getting started

### 1/ Cloning the example

Make sure you have `Node.js` installed locally; we recommend using Node v18+.

```bash
$ git clone https://github.com/0xkey-io/sdk-js
$ cd sdk/
$ corepack enable
$ pnpm install -r
$ pnpm run build-all
$ cd examples/eth-usdc-swap/
```

---

### 2/ Setting up ZeroXKey

Follow the [Quickstart](https://docs.0xkey.com/getting-started/quickstart) to create:

- A ZeroXKey API key pair
- An organization ID
- A ZeroXKey wallet account

Once ready, create a `.env.local` file:

```bash
$ cp .env.local.example .env.local
```

Fill in the following values:

- `API_PUBLIC_KEY`
- `API_PRIVATE_KEY`
- `BASE_URL`
- `ORGANIZATION_ID`
- `SIGN_WITH` — ZeroXKey wallet account address (the ETH source)

If using the non-sponsored path, ensure your wallet is funded with ETH on Base.

---

### 3/ Running the script

```bash
$ pnpm start
```

You will be prompted to choose whether to use ZeroXKey gas sponsorship.
The script will then:

1. Wrap ETH into WETH inside the Universal Router
2. Swap WETH → USDC
3. Send USDC directly to your wallet

On success, the transaction hash will be printed with a BaseScan link.

Example output:

```
🔐 Using wallet: 0x1234...abcd

✔ Swap executed successfully
Tx: https://basescan.org/tx/0xabcdef...
```

---

## Notes

- This example performs the swap in **a single transaction**
- No Permit2 approval is required for ETH → USDC
- Both sponsored and non-sponsored flows are supported
- Slippage protection is disabled (`amountOutMin = 0`) for simplicity
