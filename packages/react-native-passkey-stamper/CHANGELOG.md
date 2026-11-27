# @0xkey-io/react-native-passkey-stamper

## 0.1.5

### Patch Changes

- [#73](https://github.com/0xkey-io/sdk-js/pull/73) [`bed9806`](https://github.com/0xkey-io/sdk-js/commit/bed9806331d1db91bdfe58f8d211d6515a60143e) Author [@torbensen](https://github.com/torbensen) - 修复 0.1.4 的 npm 包缺少 `dist/index.d.ts` 的问题：TypeScript 使用方拿不到类型。
  原因是发布时各包并发执行 `prepublishOnly`（`clean` + `build`），本包构建时依赖的
  `@0xkey-io/http` 的 `dist/` 恰好被清空，类型检查报错，Rollup 的 TypeScript 插件只告警并
  跳过出错模块的声明文件，构建仍以 0 退出。现在 TypeScript 报错会让构建失败，`pack-smoke`
  也会检查 `package.json` 的 `types`、`main`、`module`、`exports` 指向的文件都在打包产物里。
  本补丁版本重新发布后，包内含 `dist/index.d.ts`。
- Updated dependencies [[`caf6478`](https://github.com/0xkey-io/sdk-js/commit/caf6478c237dcebae650ff85de2a7241227c600e)]:
  - @0xkey-io/http@0.2.1

## 0.1.4

### Patch Changes

- Updated dependencies [[`9a9008c`](https://github.com/0xkey-io/sdk-js/commit/9a9008cd5926266e51e24eb53b29b2844282a224), [`7a09cd9`](https://github.com/0xkey-io/sdk-js/commit/7a09cd93c3dba20ac01e551196605e359dcaf20e), [`94137a0`](https://github.com/0xkey-io/sdk-js/commit/94137a059397ae3d70b141173a8d3c844705ac71)]:
  - @0xkey-io/http@0.2.0

## 0.1.3

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/http@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/http@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @0xkey-io/encoding@0.1.1
  - @0xkey-io/http@0.1.1

## 0.1.0

Initial release.
