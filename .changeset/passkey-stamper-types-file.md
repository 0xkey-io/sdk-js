---
"@0xkey-io/react-native-passkey-stamper": patch
---

修复 0.1.4 的 npm 包缺少 `dist/index.d.ts` 的问题：TypeScript 使用方拿不到类型。
原因是发布时各包并发执行 `prepublishOnly`（`clean` + `build`），本包构建时依赖的
`@0xkey-io/http` 的 `dist/` 恰好被清空，类型检查报错，Rollup 的 TypeScript 插件只告警并
跳过出错模块的声明文件，构建仍以 0 退出。现在 TypeScript 报错会让构建失败，`pack-smoke`
也会检查 `package.json` 的 `types`、`main`、`module`、`exports` 指向的文件都在打包产物里。
本补丁版本重新发布后，包内含 `dist/index.d.ts`。
