import rollup from "../../rollup.config.base.mjs";

export default (options) =>
  rollup({
    input: {
      index: "src/index.ts",
      "native/google-ios-installed": "src/native/google-ios-installed.ts",
    },
  });
