import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function mountSample({ holdOtp = false } = {}) {
  const paramsReads = [];
  const initOtpCalls = [];
  const pendingOtp = [];
  let hookIndex = 0;
  let dirty = false;
  let tree;
  let pendingEffects = [];
  let randomCalls = 0;
  const hooks = [];
  const marker = (name) => Object.assign(() => {}, { displayName: name });
  const CaptchaChallenge = marker("CaptchaChallenge");
  const Button = marker("Button");
  const Text = marker("Text");
  const View = marker("View");

  const sameDeps = (left, right) =>
    left?.length === right?.length &&
    left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hooks)) {
        hooks[index] = {
          value: typeof initial === "function" ? initial() : initial,
        };
      }
      return [
        hooks[index].value,
        (value) => {
          hooks[index].value =
            typeof value === "function" ? value(hooks[index].value) : value;
          dirty = true;
        },
      ];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useMemo(compute, deps) {
      const index = hookIndex++;
      if (!(index in hooks) || !sameDeps(hooks[index].deps, deps)) {
        hooks[index] = { value: compute(), deps };
      }
      return hooks[index].value;
    },
    useCallback(fn, deps) {
      return react.useMemo(() => fn, deps);
    },
    useEffect(effect, deps) {
      const index = hookIndex++;
      if (!(index in hooks) || !sameDeps(hooks[index].deps, deps)) {
        pendingEffects.push({ index, effect, deps });
      }
    },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const modules = {
    "expo-crypto": {
      getRandomBytes(length) {
        randomCalls += 1;
        return Uint8Array.from({ length }, (_, index) => index + randomCalls);
      },
    },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      Button,
      Text,
      View,
      StyleSheet: { create: (value) => value },
    },
    "@0xkey-io/core": {
      getClientParams() {
        const read = deferred();
        paramsReads.push(read);
        return read.promise;
      },
      OtpType: { Email: "email" },
      ZeroXKeyClient: class {
        init() {
          return Promise.resolve();
        }
        initOtp(input) {
          initOtpCalls.push(input);
          if (holdOtp) {
            const request = deferred();
            pendingOtp.push(request);
            return request.promise;
          }
          return Promise.resolve();
        }
      },
    },
    "./CaptchaChallenge": { default: CaptchaChallenge },
  };
  const source = readFileSync(
    resolve(import.meta.dirname, "../App.tsx"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      if (!(name in modules)) throw new Error(`Unexpected module: ${name}`);
      return modules[name];
    },
    process: {
      env: {
        EXPO_PUBLIC_AUTH_PROXY_URL: "https://auth.example.test",
        EXPO_PUBLIC_CONFIG_ID: "5cc1732a-b599-43c8-a61e-041d1821d0fd",
        EXPO_PUBLIC_ORGANIZATION_ID: "org-test",
        EXPO_PUBLIC_TEST_EMAIL: "test@example.test",
        EXPO_PUBLIC_CAPTCHA_ORIGIN: "https://captcha.staging.0xkey.io",
      },
    },
    Uint8Array,
  });

  const walk = (node, predicate) => {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) {
      const found = walk(child, predicate);
      if (found) return found;
    }
    return null;
  };
  const app = exports.default;
  return {
    paramsReads,
    initOtpCalls,
    pendingOtp,
    renderOnly() {
      hookIndex = 0;
      pendingEffects = [];
      dirty = false;
      tree = app();
      return tree;
    },
    commitEffects() {
      for (const { index, effect, deps } of pendingEffects) {
        hooks[index]?.cleanup?.();
        hooks[index] = { deps, cleanup: effect() };
      }
      pendingEffects = [];
    },
    async settle() {
      for (let index = 0; index < 8; index++) {
        this.renderOnly();
        this.commitEffects();
        await Promise.resolve();
        await Promise.resolve();
        if (!dirty) return;
      }
      throw new Error("Sample did not settle");
    },
    pressNewAttempt() {
      const button = walk(
        tree,
        (node) =>
          node.type === Button && node.props.title === "Start a new attempt",
      );
      assert.ok(button);
      button.props.onPress();
    },
    challenge() {
      return walk(tree, (node) => node.type === CaptchaChallenge);
    },
    offButton() {
      return walk(
        tree,
        (node) => node.type === Button && node.props.title === "Start OTP",
      );
    },
    statusText() {
      return tree.props.children[1].props.children;
    },
  };
}

test("new attempt hides the previous enabled challenge before effects run", async () => {
  const app = mountSample();
  await app.settle();
  assert.equal(app.paramsReads.length, 1);
  app.paramsReads[0].resolve({ turnstileSiteKey: "site-old" });
  await app.settle();
  assert.equal(app.challenge()?.props.siteKey, "site-old");

  app.pressNewAttempt();
  app.renderOnly();
  assert.equal(app.challenge(), null);
  assert.equal(app.offButton(), null);
});

test("new attempt hides the previous off action before effects run", async () => {
  const app = mountSample();
  await app.settle();
  app.paramsReads[0].resolve({});
  await app.settle();
  assert.ok(app.offButton());

  app.pressNewAttempt();
  app.renderOnly();
  assert.equal(app.challenge(), null);
  assert.equal(app.offButton(), null);
});

test("late previous response cannot grant enabled or off state to a new attempt", async () => {
  const app = mountSample();
  await app.settle();
  assert.equal(app.paramsReads.length, 1);

  app.pressNewAttempt();
  app.paramsReads[0].resolve({ turnstileSiteKey: "site-old" });
  await Promise.resolve();
  app.renderOnly();
  assert.equal(app.challenge(), null);
  assert.equal(app.offButton(), null);
  app.commitEffects();
  await app.settle();
  assert.equal(app.paramsReads.length, 2);

  app.paramsReads[1].resolve({});
  await app.settle();
  assert.equal(app.challenge(), null);
  assert.ok(app.offButton());
});

test("captured old off button cannot submit OTP after a new attempt starts", async () => {
  const app = mountSample();
  await app.settle();
  app.paramsReads[0].resolve({});
  await app.settle();
  const oldButton = app.offButton();
  assert.ok(oldButton);

  app.pressNewAttempt();
  oldButton.props.onPress();
  assert.equal(app.initOtpCalls.length, 0);
});

test("captured old challenge callback cannot submit OTP after a new attempt starts", async () => {
  const app = mountSample();
  await app.settle();
  app.paramsReads[0].resolve({ turnstileSiteKey: "site-old" });
  await app.settle();
  const oldChallenge = app.challenge();
  assert.ok(oldChallenge);

  app.pressNewAttempt();
  await oldChallenge.props.onToken("stale-opaque-token");
  assert.equal(app.initOtpCalls.length, 0);
});

test("current off and challenge callbacks still submit their own OTP request", async () => {
  const off = mountSample();
  await off.settle();
  off.paramsReads[0].resolve({});
  await off.settle();
  off.offButton().props.onPress();
  assert.equal(off.initOtpCalls.length, 1);
  assert.equal(off.initOtpCalls[0].captchaToken, undefined);

  const enabled = mountSample();
  await enabled.settle();
  enabled.paramsReads[0].resolve({ turnstileSiteKey: "site-current" });
  await enabled.settle();
  await enabled.challenge().props.onToken("current-opaque-token");
  assert.equal(enabled.initOtpCalls.length, 1);
  assert.equal(enabled.initOtpCalls[0].captchaToken, "current-opaque-token");
});

test("captured old challenge failure cannot overwrite new attempt status", async () => {
  const app = mountSample();
  await app.settle();
  app.paramsReads[0].resolve({ turnstileSiteKey: "site-old" });
  await app.settle();
  const oldChallenge = app.challenge();

  app.pressNewAttempt();
  oldChallenge.props.onFailure();
  app.renderOnly();
  assert.equal(app.statusText(), "Reading current client params…");
});

test("old OTP completion cannot overwrite the status of a new attempt", async () => {
  const app = mountSample({ holdOtp: true });
  await app.settle();
  app.paramsReads[0].resolve({ turnstileSiteKey: "site-current" });
  await app.settle();
  const oldSubmission = app.challenge().props.onToken("current-token");
  assert.equal(app.pendingOtp.length, 1);

  app.pressNewAttempt();
  app.pendingOtp[0].resolve();
  await oldSubmission;
  app.renderOnly();
  assert.equal(app.statusText(), "Reading current client params…");
});
