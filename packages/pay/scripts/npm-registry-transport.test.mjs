import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { rootCertificates, checkServerIdentity } from "node:tls";
import test from "node:test";
import { requestRegistry } from "./collect-published-npm-receipt.mjs";
import { strictJson } from "./npm-receipt-json.mjs";

const options = {
  path: "/@0xkey-io%2fpay/1.0.0-rc.1",
  kind: "json",
  limit: 2097152,
};
function syntheticRequest(send, inspect = () => {}) {
  return (requestOptions, callback) => {
    inspect(requestOptions);
    const request = new EventEmitter();
    request.destroy = () => {
      request.destroyed = true;
    };
    request.end = () =>
      queueMicrotask(() => {
        const response = new EventEmitter();
        Object.assign(response, {
          socket: { authorized: true },
          statusCode: 200,
          rawHeaders: [
            "Content-Type",
            "application/json",
            "Content-Length",
            "2",
          ],
          complete: true,
        });
        response.destroy = () => {
          response.destroyed = true;
        };
        send({ request, response, callback });
      });
    return request;
  };
}

test("production HTTPS request ignores ambient proxy and npm credentials", async () => {
  const hostile = {
    HTTPS_PROXY: "http://SECRET_SENTINEL.invalid",
    NODE_USE_ENV_PROXY: "1",
    NPM_CONFIG_USERCONFIG: "/SECRET_SENTINEL",
    NODE_AUTH_TOKEN: "SECRET_SENTINEL",
  };
  const previous = Object.fromEntries(
    Object.keys(hostile).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, hostile);
  try {
    const result = await requestRegistry(
      options,
      syntheticRequest(
        ({ response, callback }) => {
          callback(response);
          response.emit("data", Buffer.from("{}"));
          response.emit("end");
        },
        (config) => {
          assert.equal(config.hostname, "registry.npmjs.org");
          assert.equal(config.servername, "registry.npmjs.org");
          assert.equal(config.protocol, "https:");
          assert.equal(config.method, "GET");
          assert.equal(config.path, options.path);
          assert.equal(config.rejectUnauthorized, true);
          assert.equal(config.checkServerIdentity, checkServerIdentity);
          assert.deepEqual(config.ca, rootCertificates);
          assert.deepEqual(config.agent.options.ca, rootCertificates);
          assert.equal(config.agent.options.rejectUnauthorized, true);
          assert.deepEqual(config.agent.options.proxyEnv, {});
          assert.deepEqual(config.headers, {
            Accept: "application/json",
            "Accept-Encoding": "identity",
          });
          assert.equal(config.auth, undefined);
          assert.equal(config.cert, undefined);
          assert.equal(config.key, undefined);
          assert.equal(config.maxHeaderSize, 16384);
        },
      ),
    );
    assert.equal(result.body.toString(), "{}");
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

// Real native TLS initialization is the boundary under test. The injected
// request stops immediately after context creation, before any socket exists.
const nativeProbe = `
(async () => {
  const { createSecureContext } = await import("node:tls");
  const { requestRegistry } = await import(${JSON.stringify(new URL("./collect-published-npm-receipt.mjs", import.meta.url).href)});
  try {
    await requestRegistry(${JSON.stringify(options)}, config => {
      process.stdout.write("native-context-called\\n");
      createSecureContext(config);
      process.stdout.write("native-context-created\\n");
      throw new Error("stop before opening any socket");
    });
  } catch (error) { process.stdout.write(error.message + "\\n"); }
})();`;

test("fresh native TLS request rejects startup CA/runtime inputs before native discovery", async (t) => {
  for (const [key, value] of [
    ["NODE_EXTRA_CA_CERTS", "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL"],
    ["NODE_OPTIONS", "--use-bundled-ca"],
    ["NODE_TLS_REJECT_UNAUTHORIZED", "0"],
    ["NODE_USE_SYSTEM_CA", "1"],
    ["SSL_CERT_FILE", "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL"],
    ["SSL_CERT_DIR", "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL"],
    ["OPENSSL_CONF", "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL"],
    ["OPENSSL_CONF_INCLUDE", "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL"],
    ["OPENSSL_MODULES", "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL"],
    ["OPENSSL_ENGINES", "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL"],
    ["SSLKEYLOGFILE", "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL"],
    ["NODE_DEBUG", "tls"],
    ["NODE_DEBUG_NATIVE", "tls"],
    ["NODE_EXTRA_CA_CERTS", ""],
  ])
    await t.test(key + (value === "" ? " empty" : ""), () => {
      const result = spawnSync(process.execPath, [], {
        input: nativeProbe,
        encoding: "utf8",
        env: { [key]: value },
      });
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "PAY_NPM_RUNTIME_ENVIRONMENT\n");
      assert.equal(result.stderr, "");
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /SECRET_SENTINEL|native-context/,
      );
    });
});

test("fresh clean native TLS request constructs verified bundled-root context without sockets", () => {
  const result = spawnSync(process.execPath, [], {
    input: nativeProbe,
    encoding: "utf8",
    env: {},
  });
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    "native-context-called\nnative-context-created\nPAY_NPM_HTTP_TRANSPORT\n",
  );
  assert.equal(result.stderr, "");
});

test("runtime flags cannot select native TLS configuration", () => {
  const result = spawnSync(process.execPath, ["--use-bundled-ca"], {
    input: nativeProbe,
    encoding: "utf8",
    env: {},
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "PAY_NPM_RUNTIME_ENVIRONMENT\n");
  assert.equal(result.stderr, "");
});

test("clearing extra CA after importing collector cannot undo its rejected startup environment", () => {
  const result = spawnSync(process.execPath, [], {
    input: nativeProbe.replace(
      "  try {",
      "  delete process.env.NODE_EXTRA_CA_CERTS;\n  try {",
    ),
    encoding: "utf8",
    env: { NODE_EXTRA_CA_CERTS: "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL" },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "PAY_NPM_RUNTIME_ENVIRONMENT\n");
  assert.equal(result.stderr, "");
});

test("adding an unsupported CA input after module entry also rejects before native TLS", () => {
  const result = spawnSync(process.execPath, [], {
    input: nativeProbe.replace(
      "  try {",
      '  process.env.NODE_EXTRA_CA_CERTS = "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL";\n  try {',
    ),
    encoding: "utf8",
    env: {},
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "PAY_NPM_RUNTIME_ENVIRONMENT\n");
  assert.equal(result.stderr, "");
});

test("direct collector CLI rejects unsupported startup environment before reading inputs", () => {
  const result = spawnSync(
    process.execPath,
    [
      new URL("./collect-published-npm-receipt.mjs", import.meta.url).pathname,
      "--checked-tar",
      "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL",
      "--source-context",
      "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL",
      "--expected-version",
      "1.0.0-rc.1",
      "--expected-source",
      "a".repeat(40),
      "--output",
      "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL",
    ],
    {
      encoding: "utf8",
      env: {
        NODE_EXTRA_CA_CERTS: "/nonexistent/PAY_NPM_NATIVE_SECRET_SENTINEL",
      },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    `receipt-capture: PAY_NPM_${process.versions.node === "24.3.0" ? "RUNTIME_ENVIRONMENT" : "RUNTIME"}\n`,
  );
});

test("HTTPS stream rejects TLS, redirects, truncation, encoding, framing and size", async (t) => {
  for (const [name, change, expected] of [
    [
      "TLS unauthorized",
      (r) => {
        r.socket.authorized = false;
      },
      "PAY_NPM_HTTP_TLS",
    ],
    [
      "redirect",
      (r) => {
        r.statusCode = 302;
      },
      "PAY_NPM_HTTP_STATUS",
    ],
    [
      "truncated",
      (r) => {
        r.complete = false;
      },
      "PAY_NPM_HTTP_TRUNCATED",
    ],
    [
      "declared size",
      (r) => {
        r.rawHeaders[3] = "2097153";
      },
      "PAY_NPM_HTTP_SIZE",
    ],
    [
      "content type",
      (r) => {
        r.rawHeaders[1] = "text/plain";
      },
      "PAY_NPM_HTTP_CONTENT_TYPE",
    ],
    [
      "encoding",
      (r) => {
        r.rawHeaders.push("Content-Encoding", "gzip");
      },
      "PAY_NPM_HTTP_ENCODING",
    ],
    [
      "framing",
      (r) => {
        r.rawHeaders.push("Transfer-Encoding", "chunked");
      },
      "PAY_NPM_HTTP_FRAMING",
    ],
  ])
    await t.test(name, async () => {
      await assert.rejects(
        requestRegistry(
          options,
          syntheticRequest(({ response, callback }) => {
            change(response);
            callback(response);
            if (!response.destroyed) {
              response.emit("data", Buffer.from("{}"));
              response.emit("end");
            }
          }),
        ),
        { message: expected },
      );
    });
  for (const [name, send, expected] of [
    [
      "stream oversize",
      (r) => {
        r.emit("data", Buffer.alloc(2097153));
      },
      "PAY_NPM_HTTP_SIZE",
    ],
    [
      "aborted",
      (r) => {
        r.emit("aborted");
      },
      "PAY_NPM_HTTP_TRUNCATED",
    ],
    [
      "stream error",
      (r) => {
        r.emit("error", new Error("SECRET_SENTINEL"));
      },
      "PAY_NPM_HTTP_TRANSPORT",
    ],
  ])
    await t.test(name, async () => {
      await assert.rejects(
        requestRegistry(
          options,
          syntheticRequest(({ response, callback }) => {
            callback(response);
            send(response);
          }),
        ),
        { message: expected },
      );
    });
  await t.test("request failure is redacted", async () => {
    await assert.rejects(
      requestRegistry(
        options,
        syntheticRequest(({ request }) =>
          request.emit("error", new Error("SECRET_SENTINEL")),
        ),
      ),
      { message: "PAY_NPM_HTTP_TRANSPORT" },
    );
  });
});

test("request deadline is total 30 seconds, with no automatic retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const result = requestRegistry(
    options,
    syntheticRequest(
      () => {},
      () => {
        calls++;
      },
    ),
  );
  const rejection = assert.rejects(result, { message: "PAY_NPM_HTTP_TIMEOUT" });
  t.mock.timers.tick(30000);
  await rejection;
  assert.equal(calls, 1);
});

test("strict JSON preserves primitive types and byte ranges without prototype pollution", () => {
  const bytes = Buffer.from(
    '{"text":"中文","__proto__":{"polluted":true},"bundle": { "x":false,"n":12,"a":[null,"}"] }}',
  );
  const result = strictJson(bytes);
  assert.equal(result.value.bundle.x, false);
  assert.equal(result.value.bundle.n, 12);
  assert.equal(result.value.bundle.a[0], null);
  assert.equal({}.polluted, undefined);
  const range = result.ranges.get(result.value.bundle);
  assert.equal(
    bytes.subarray(range.start, range.end).toString(),
    '{ "x":false,"n":12,"a":[null,"}"] }',
  );
});

test("strict JSON rejects duplicate escapes, invalid tokens, Unicode, depth and cardinality", async (t) => {
  for (const text of [
    '{"a":1,"\\u0061":2}',
    '{"x":1,}',
    "[1,]",
    '{"x":01}',
    '{"x":NaN}',
    '{"x":1e400}',
    '"\\ud800"',
    "\ufeff{}",
    "{} {}",
    "[".repeat(65) + "0" + "]".repeat(65),
    '"' + "x".repeat(1048577) + '"',
    "[" + Array(100001).fill("0").join(",") + "]",
  ]) {
    await t.test(`malformed ${text.length} bytes`, () =>
      assert.throws(
        () => strictJson(Buffer.from(text)),
        /^Error: PAY_NPM_[A-Z0-9_]+$/,
      ),
    );
  }
});

test("production CLIs reject override flags and redact candidate input errors", () => {
  for (const script of [
    "collect-published-npm-receipt.mjs",
    "prepare-npm-source-context.mjs",
  ]) {
    for (const option of [
      "--registry",
      "--package",
      "--ca",
      "--transport",
      "--test-mode",
      "--executable",
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          new URL(`./${script}`, import.meta.url).pathname,
          option,
          "SECRET_SENTINEL",
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(
        result.stderr,
        /^(?:receipt-capture|preservation): PAY_NPM_ARGUMENTS\n$/,
      );
      assert.doesNotMatch(result.stderr, /SECRET_SENTINEL| at |Error:/);
    }
  }
});

test("read-only collector CLI requires the publisher's pinned Node runtime", () => {
  const script = new URL(
    "./collect-published-npm-receipt.mjs",
    import.meta.url,
  );
  const command = `Object.defineProperty(process.versions, "node", {value:"22.12.0"});
process.argv = [process.execPath, ${JSON.stringify(script.pathname)}, "--checked-tar", "/absent", "--source-context", "/absent", "--expected-version", "1.0.0-rc.1", "--expected-source", "${"a".repeat(40)}", "--output", "/absent-output"];
await import(${JSON.stringify(script.href)});`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", command],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "receipt-capture: PAY_NPM_RUNTIME\n");
});
