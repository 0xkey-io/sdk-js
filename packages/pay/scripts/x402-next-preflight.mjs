import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { check, hash } from "./x402-boundary-runtime.mjs";
const [app] = process.argv.slice(2);
const req = createRequire(resolve(app, "package.json"));
const expected = { typescript: "5.4.3", "@types/react": "19.1.17", "@types/node": "24.7.1", next: "16.2.6", react: "19.2.4", "react-dom": "19.2.4" };
const inventory = Object.entries(expected).map(([name, version]) => {
  const path = realpathSync(req.resolve(name + "/package.json"));
  const bytes = readFileSync(path); check(JSON.parse(bytes).version === version, "exact-next-input-" + name);
  return { name, version, path, sha256: hash(bytes) };
});
const { hasNecessaryDependencies } = req("next/dist/lib/has-necessary-dependencies");
const result = await hasNecessaryDependencies(app, [
  { file: "typescript/lib/typescript.js", pkg: "typescript", exportsRestrict: true },
  { file: "@types/react/index.d.ts", pkg: "@types/react", exportsRestrict: true },
  { file: "@types/node/index.d.ts", pkg: "@types/node", exportsRestrict: true },
]);
check(result.missing.length === 0, "no-implicit-next-install");
check(process.env.NPM_CONFIG_OFFLINE === "true" && process.env.PNPM_CONFIG_OFFLINE === "true" && process.env.COREPACK_ENABLE_NETWORK === "0", "offline-next-build-environment");
console.log(JSON.stringify({ inventory, missing: result.missing, resolved: Object.fromEntries(result.resolved), offline: true }));
