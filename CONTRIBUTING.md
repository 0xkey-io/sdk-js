# Contributing

## Repo overview

- [`packages/`](/packages/): ZeroXKey npm packages.
- [`examples/`](/examples/): Examples and templates. Won't be published to npm.
- [`internal/`](/internal/): Internal scripts and configs. Won't be published to npm.

See [RELEASING.md](/RELEASING.md) for npm publishing instructions.
Every recursive publish must explicitly exclude `@0xkey-io/pay`. Pay release
candidates are published only from the checked tarball in the protected
`pay-publish.yml` workflow with npm tag `next`; a public GA `latest` release is
a separate future gated operation.

Pay is permanently `private: true` in the source manifest. Only the artifact
checker may create a public Pay RC manifest, and it does so only while packing,
with exact byte restoration before the tarball is verified or emitted. The Pay
workflow requires the separately configured npm trusted publisher for exact
workflow `pay-publish.yml` and environment `production`; the generic
`NPM_TOKEN` must not have Pay write access. Repository documentation does not
claim those external settings are already configured.

## Getting started

Clone the repo:

```bash
$ git clone https://github.com/0xkey-io/sdk-js/
$ cd sdk/
```

Install [nvm (node version manager)](https://github.com/nvm-sh/nvm):

```bash
$ wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash
```

Now open a new terminal to install Node.js:

```bash
$ nvm install # Install the version specified in `.nvmrc`
$ nvm use # Activate the local version
```

Use `corepack` to install/manage [`pnpm`](https://pnpm.io):

```bash
$ corepack enable
$ pnpm --version # Should output "8.4.0"
```

Finally, install dependencies and compile source code:

```bash
$ pnpm install -r
$ pnpm run -w build-all
```
