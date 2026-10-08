---
"@0xkey-io/core": patch
"@0xkey-io/react-wallet-kit": patch
"@0xkey-io/react-native-wallet-kit": patch
"@0xkey-io/sdk-server": patch
---

明确 TypeScript 消费者支持下限：TypeScript 5.4 及以上，并使用
`moduleResolution: "bundler"`（`module` 为 `esnext` 或 `preserve`）。依赖 `ox`
本身要求 TypeScript 5.4+。`node16`／`nodenext` 解析不在支持范围内：严格模式且
`skipLibCheck: false` 时，Core 与 React Wallet Kit 会因 `ox` → `abitype` 及 Core →
`@wallet-standard/base` 的 CommonJS 声明引用 ESM 声明而报 `TS1479`，SDK 不提供双声明构建来规避。
`encoding`、`crypto`、`api-key-stamper`、`attested-stamper` 目前仍能在 Node16 下通过类型检查，
仓库继续检查，但不作为兼容承诺。本次不改运行时代码、依赖版本或锁文件。
