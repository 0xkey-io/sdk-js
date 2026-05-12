# Example: `foundry`

This example shows how to set up and broadcast a smart contract from a ZeroXKey wallet using Foundry & Forge.

## Getting started

### 0 / Foundry versioning

Make sure you have [Foundry](https://getfoundry.sh/introduction/installation) installed locally.
ZeroXKey support was introduced with v1.5.0.

```bash
$ curl -L https://foundry.paradigm.xyz | bash
$ foundryup
```

### 1/ Cloning the example

```bash
$ git clone https://github.com/0xkey-io/sdk-js
$ cd sdk/examples/foundry/
$ forge install foundry-rs/forge-std --no-git
```

### 2/ Setting up ZeroXKey

The first step is to set up your ZeroXKey organization and account. By following the [Quickstart](https://docs.0xkey.com/getting-started/quickstart) guide, you should have:

- A public/private API key pair for ZeroXKey
- An organization ID
- A ZeroXKey wallet account (address), private key address, or a private key ID

Once you've gathered these values, add them to a new `.env` file. Notice that your private key should be securely managed and **_never_** be committed to git.

```bash
$ cp .env.example .env
```

Now open `.env` and add the missing environment variables:

- `ZEROXKEY_API_PRIVATE_KEY`
- `ZEROXKEY_ORGANIZATION_ID`
- `ZEROXKEY_ADDRESS` -- a ZeroXKey wallet account address, private key address, or private key ID

For convenience we have hardcoded several popular chains and RPCs in `foundry.toml`, but you're welcome to change for different values.

### 3/ Running the sample deploy script

The following command will compile and broadcast Foundry's demo `Counter.sol` contract to the Sepolia network.
You will need some SepoliaETH in your ZeroXKey wallet address.

```bash
$ forge script script/Counter.s.sol --rpc-url sepolia --0xkey --broadcast
```

Visit the relevant chain explorer to view your transaction; you have successfully signed and deployed your first contract with ZeroXKey!

See the following for a sample output:

```
[⠊] Compiling...
No files changed, compilation skipped
Script ran successfully.

## Setting up 1 EVM.

==========================

Chain 11155111

Estimated gas price: 0.001037667 gwei

Estimated total gas used for script: 203856

Estimated amount required: 0.000000211534643952 ETH

==========================

##### sepolia
✅  [Success] Hash: 0xf492f7059d91ec1b91537a82b55289d1091e2a498db2881bd04d19b26ad29e0d
Contract Address: 0x2352D015613705F2c365dEead916d45BAaf547d4
Block: 9624270
Paid: 0.000000162718420767 ETH (156813 gas * 0.001037659 gwei)

✅ Sequence #1 on sepolia | Total Paid: 0.000000162718420767 ETH (156813 gas * avg 0.001037659 gwei)


==========================
```
