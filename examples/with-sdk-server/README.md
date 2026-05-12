# Example: `with-sdk-server`

This example shows how to set up our server SDK ([`@0xkey-io/sdk-server`](https://www.npmjs.com/package/@0xkey-io/sdk-server)) and call our API endpoints.

## Getting started

### 1/ Cloning the example

Make sure you have `node` installed locally; we recommend using Node v18+.

```bash
$ git clone https://github.com/0xkey-io/sdk-js
$ cd sdk/
$ corepack enable  # Install `pnpm`
$ pnpm install -r  # Install dependencies
$ pnpm run build-all  # Compile source code
$ cd examples/with-sdk-server/
```

### 2/ Setting up ZeroXKey

The first step is to set up your ZeroXKey organization and account. By following the [Quickstart](https://docs.0xkey.com/getting-started/quickstart) guide, you should have:

- A public/private API key pair for ZeroXKey
- An organization ID

Once you've gathered these values, add them to a new `config.json` file. Notice that your API private key should be securely managed and **_never_** be committed to git.

```bash
$ cp config.json.example config.json
```

Now open `config.json` and add the missing values: `apiPublicKey`, `apiPrivateKey`, and `organizationId`.

### 3/ Run the example

```bash
$ pnpm run start
```

This will simply make a [`Whoami request`](https://docs.0xkey.com/api#tag/Sessions/operation/GetWhoami). If it's successful you should see something like the following:

```
Successfully called ZeroXKey. Whoami response:  {
  organizationId: '4c9c6e70-d30b-405f-ae30-41e766279eb6',
  organizationName: 'Test',
  userId: '7fd1bc44-9a4f-47ec-aad2-8a4a2a5de82e',
  username: 'Root user'
}
```
