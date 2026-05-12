# @0xkey-io/viem

[![npm](https://img.shields.io/npm/v/@0xkey-io/viem?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/viem)

This package contains helpers to use [Viem](https://viem.sh/) with [ZeroXKey](https://0xkey.com).

We provide a ZeroXKey [Custom Account](https://viem.sh/docs/accounts/custom.html#custom-account) (signer) which implements the signing APIs expected by Viem clients.

If you need a lower-level, fully typed HTTP client for interacting with ZeroXKey API, check out [`@0xkey-io/http`](https://www.npmjs.com/package/@0xkey-io/http).

## Getting started

```bash
$ npm install viem @0xkey-io/viem
```

```typescript
import { createAccount } from "@0xkey-io/viem";
import { ZeroXKeyClient } from "@0xkey-io/http";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";
import { createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";

async function main() {
  // Create a ZeroXKey HTTP client with API key credentials
  const httpClient = new ZeroXKeyClient(
    {
      baseUrl: "https://api.0xkey.com",
    },
    // This uses API key credentials.
    // If you're using passkeys, use `@0xkey-io/webauthn-stamper` to collect webauthn signatures:
    // new WebauthnStamper({...options...})
    new ApiKeyStamper({
      apiPublicKey: "...",
      apiPrivateKey: "...",
    }),
  );

  // Create the Viem custom account
  const zeroXKeyAccount = await createAccount({
    client: httpClient,
    organizationId: "...",
    signWith: "...",
    // optional; will be fetched from ZeroXKey if not provided
    ethereumAddress: "...",
  });

  // Below: standard Viem APIs are used, nothing special!

  const client = createWalletClient({
    account: zeroXKeyAccount,
    chain: sepolia,
    transport: http(`https://sepolia.infura.io/v3/$(YOUR_INFURA_API_KEY)`),
  });

  const transactionRequest = {
    to: "0x08d2b0a37F869FF76BACB5Bab3278E26ab7067B7" as `0x${string}`,
    value: 1000000000000000n, // 0.001 ETH
  };

  const txHash = await client.sendTransaction(transactionRequest);
  console.log(`Success! Transaction broadcast with hash ${txHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

## Testing (Local)

1. Copy `.env.example` to `.env`

   ```bash
   $ cp .env.example .env
   ```

2. Start the Anvil node in one shell:
   - Install [Foundry](https://book.getfoundry.sh/getting-started/installation) & Anvil if you haven't done so already
   - Add Foundry to your `$PATH`
     ```bash
     $ export PATH="$PATH:$HOME/.foundry/bin"
     ```
   - Source your env e.g.
     ```bash
     $ source ~/.zshrc
     ```
   - Run `foundryup` to install `Anvil`
     ```bash
     $ foundryup
     ```
   - Start Anvil
     ```
     $ pnpm anvil
     ```

3. Run the tests in a new shell:

   ```
   $ pnpm test
   ```

## See also

- [`@0xkey-io/example-with-viem`](https://github.com/0xkey-io/sdk-js/tree/main/examples/with-viem): example using this package to create, sign, and broadcast a transaction on Sepolia (Ethereum testnet)
- [`@0xkey-io/http`](https://www.npmjs.com/package/@0xkey-io/http): lower-level fully typed HTTP client for interacting with ZeroXKey API
- [`@0xkey-io/api-key-stamper`](https://www.npmjs.com/package/@0xkey-io/api-key-stamper): package to authenticate to ZeroXKey using API key credentials
- [`@0xkey-io/webauthn-stamper`](https://www.npmjs.com/package/@0xkey-io/webauthn-stamper): package to authenticate to ZeroXKey using Webauthn/passkeys.

## Transaction types supported

- ZeroXKey's Viem implementation now supports all transaction types: legacy, EIP-2930 (Type 1), EIP-1559 (Type 2), EIP-4844 (Type 3), and EIP-7702 (Type 4). See [with-viem](https://github.com/0xkey-io/sdk-js/tree/main/examples/with-viem/) for examples of scripts that sign using those various types.
