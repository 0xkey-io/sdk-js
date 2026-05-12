# @0xkey-io/sdk-types

[![npm](https://img.shields.io/npm/v/@0xkey-io/sdk-types?color=%234C48FF)](https://www.npmjs.com/package/@0xkey-io/sdk-types)

## Getting started

A package for common and reusable ZeroXKey Types which can be used for consistent typing across packages.

### Installation

#### npm

```bash
$ npm install @0xkey-io/sdk-types
```

#### Yarn

```bash
$ yarn add @0xkey-io/sdk-types
```

#### pnpm

```bash
$ pnpm add @0xkey-io/sdk-types
```

### Usage

```js
import { useZeroXKey } from "@0xkey-io/react-wallet-kit";
import { SessionType } from "@0xkey-io/sdk-types";

export default function AuthComponent() {
  const { passkeyClient } = useZeroXKey();

  await passkeyClient?.loginWithPasskey({
    sessionType: SessionType.READ_WRITE,
    ...
  });
}
```
