import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");
const configUrl = new URL("../../rollup.config.base.mjs", import.meta.url).href;

function withFixture(run) {
  const fixture = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "sdk-rollup-watch-")),
  );
  try {
    fs.mkdirSync(path.join(fixture, "src"));
    fs.writeFileSync(
      path.join(fixture, "package.json"),
      '{"name":"rollup-watch-fixture","private":true}\n',
    );
    fs.writeFileSync(
      path.join(fixture, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Node",
          declaration: true,
          declarationMap: true,
          sourceMap: true,
          rootDir: "src",
          outDir: "dist",
          types: [],
        },
        include: ["src/**/*.ts"],
      }),
    );
    fs.writeFileSync(
      path.join(fixture, "src", "value.ts"),
      'export const value = "first";\n',
    );
    fs.writeFileSync(
      path.join(fixture, "src", "index.ts"),
      'import { value } from "./value";\nexport const result: string = value;\n',
    );
    run(fixture);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

const childSource = `
  const fs = require("node:fs");
  const { rollup, watch } = require("rollup");
  const ts = require("typescript");
  const fixture = process.argv[1];
  const configUrl = process.argv[2];
  const mode = process.argv[3];
  process.chdir(fixture);
  const watchedDirectories = [];
  const watchedFiles = [];
  const originalWatchDirectory = ts.sys.watchDirectory.bind(ts.sys);
  const originalWatchFile = ts.sys.watchFile.bind(ts.sys);
  ts.sys.watchFile = (file, callback, ...args) => {
    watchedFiles.push([file, callback]);
    return originalWatchFile(file, callback, ...args);
  };
  ts.sys.watchDirectory = (directory, callback, ...args) => {
    watchedDirectories.push([directory, callback]);
    return originalWatchDirectory(directory, callback, ...args);
  };
  (async () => {
    const { default: makeConfig } = await import(configUrl);
    const configs = makeConfig();
    if (mode === "build") {
      for (const config of configs) {
        const bundle = await rollup(config);
        await bundle.write(config.output);
        await bundle.close();
      }
      for (const [file, callback] of watchedFiles) callback(file, 1);
      for (const [directory, callback] of watchedDirectories) callback(directory);
      console.log("BUILD_FINISHED");
      return;
    }
    // Native fs.watch is reliable for this temporary fixture on macOS.
    configs[0].watch = { chokidar: { useFsEvents: false } };
    const watcher = watch(configs[0]);
    let builds = 0;
    watcher.on("event", async (event) => {
      if (event.code === "ERROR") throw event.error;
      if (event.code !== "END") return;
      builds++;
      if (builds === 1) {
        setTimeout(() => {
          fs.writeFileSync("src/index.ts", 'import { value } from "./value";\\nexport const result: string = value + "-second";\\n');
        }, 1000);
      } else if (builds === 2) {
        await watcher.close();
        console.log("WATCH_HANDLES", watchedFiles.length + watchedDirectories.length);
        console.log("REBUILT_IN_WATCH_MODE");
        // Watch mode intentionally keeps TypeScript handles alive; stop this child fixture.
        process.exit(0);
      }
    });
  })().catch((error) => { console.error(error); process.exitCode = 1; });
`;

test("one-shot Rollup builds both formats and exits with declarations", () => {
  withFixture((fixture) => {
    const result = spawnSync(
      process.execPath,
      ["-e", childSource, fixture, configUrl, "build"],
      { cwd: repoRoot, encoding: "utf8", timeout: 12000 },
    );
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BUILD_FINISHED/);
    assert.match(
      fs.readFileSync(path.join(fixture, "dist", "index.mjs"), "utf8"),
      /value/,
    );
    assert.match(
      fs.readFileSync(path.join(fixture, "dist", "index.js"), "utf8"),
      /value/,
    );
    assert.match(
      fs.readFileSync(path.join(fixture, "dist", "index.d.ts"), "utf8"),
      /result: string/,
    );
  });
});

test("Rollup watch rebuilds after a source edit with real TypeScript watchers", () => {
  withFixture((fixture) => {
    const result = spawnSync(
      process.execPath,
      ["-e", childSource, fixture, configUrl, "watch"],
      { cwd: repoRoot, encoding: "utf8", timeout: 12000 },
    );
    assert.equal(
      result.error,
      undefined,
      `${result.error}\n${result.stdout}\n${result.stderr}`,
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /REBUILT_IN_WATCH_MODE/);
    assert.match(result.stdout, /WATCH_HANDLES [1-9]/);
    assert.match(
      fs.readFileSync(path.join(fixture, "dist", "index.mjs"), "utf8"),
      /second/,
    );
  });
});

test("one-shot Rollup reports a syntax error with a nonzero exit", () => {
  withFixture((fixture) => {
    fs.writeFileSync(
      path.join(fixture, "src", "index.ts"),
      "export const = ;\n",
    );
    const result = spawnSync(
      process.execPath,
      ["-e", childSource, fixture, configUrl, "build"],
      { cwd: repoRoot, encoding: "utf8", timeout: 12000 },
    );
    assert.equal(result.error, undefined, String(result.error));
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /error|Unexpected token/i);
  });
});
