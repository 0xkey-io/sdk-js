import rollup from "../../rollup.config.base.mjs";

export default () =>
  rollup({
    tsconfig: "./tsconfig.pay-v1.build.json",
    input: [
      "src/index.ts",
      "src/client/index.ts",
      "src/server/index.ts",
      "src/x402/index.mts",
      "src/mpp/index.mts",
      "src/admin/index.ts",
      "src/express/index.ts",
      "src/hono/index.ts",
      "src/next/index.ts",
    ],
  });
