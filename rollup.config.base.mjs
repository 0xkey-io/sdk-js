import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import alias from "@rollup/plugin-alias";
import nodeExternals from "rollup-plugin-node-externals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripInternalReferencesFromDeclarations } from "./internal/contract-guard/scripts/strip-internal-dts.mjs";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

const getInternalAliasEntries = () => [
  {
    find: "@0xkey-io/internal-codec",
    replacement: path.join(repoRoot, "internal/codec/dist/index.mjs"),
  },
  {
    find: "@0xkey-io/internal-crypto-core",
    replacement: path.join(repoRoot, "internal/crypto-core/dist/index.mjs"),
  },
];

const getFormatConfig = (format, options = {}) => {
  const pkgPath = path.join(process.cwd(), "package.json");
  const bundleInternal = options.bundleInternal ?? false;
  const singleFile = options.singleFile ?? bundleInternal;

  /** @type {import('rollup').RollupOptions} */
  return {
    input: "src/index.ts",
    output: {
      format,
      dir: "dist",
      entryFileNames: singleFile
        ? `index.${format === "esm" ? "mjs" : "js"}`
        : `[name].${format === "esm" ? "mjs" : "js"}`,
      preserveModules: !singleFile,
      preserveModulesRoot: "src",
      sourcemap: true,
    },
    plugins: [
      nodeExternals({
        packagePath: pkgPath,
        builtinsPrefix: "ignore",
        exclude: bundleInternal ? [/^@0xkey-io\/internal-/] : [],
      }),
      ...(bundleInternal
        ? [
            alias({ entries: getInternalAliasEntries() }),
            resolve({ extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"] }),
          ]
        : []),
      typescript({
        tsconfig: "./tsconfig.json",
        outputToFilesystem: false,
        compilerOptions: {
          outDir: "dist",
          composite: false,
          declaration: format === "esm",
          declarationMap: format === "esm",
          sourceMap: true,
          skipLibCheck: true,
        },
      }),
    ],
  };
};

export default (options = {}) => {
  const esm = getFormatConfig("esm", options);
  const cjs = getFormatConfig("cjs", options);

  if (options.bundleInternal) {
    const stripDeclarations = {
      name: "strip-internal-declarations",
      writeBundle() {
        stripInternalReferencesFromDeclarations(
          path.join(process.cwd(), "dist"),
        );
      },
    };
    esm.plugins.push(stripDeclarations);
    cjs.plugins.push(stripDeclarations);
  }

  return [esm, cjs];
};
