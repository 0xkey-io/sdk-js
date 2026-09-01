import assert from "node:assert/strict";
import test from "node:test";
import { assertLoopbackUrl, assertVersions } from "../src/run.mjs";

test("literal HTTPS loopback is accepted; DNS, normalization and credentials fail before dispatch", () => {
  assert.equal(
    assertLoopbackUrl("https://127.0.0.1:443/paid").hostname,
    "127.0.0.1",
  );
  for (const url of [
    "http://127.0.0.1/",
    "https://localhost/",
    "https://127.1/",
    "https://2130706433/",
    "https://api.example.com/",
    "https://user:secret@127.0.0.1/",
    "https://127.0.0.1/#secret",
  ]) {
    assert.throws(() => assertLoopbackUrl(url), {
      message: "TRANSPORT_TARGET_REJECTED",
    });
  }
});

test("version identity rejects N/N-1 confusion and undeclared packages", () => {
  assertVersions({ "@x402/core": "2.22.0" }, { "@x402/core": "2.22.0" });
  for (const [expected, observed] of [
    [{ "@x402/core": "2.22.0" }, { "@x402/core": "2.23.0" }],
    [{ mppx: "0.8.17" }, { mppx: "0.8.19" }],
    [{ mppx: "0.8.19" }, {}],
    [{ mppx: "0.8.19" }, { mppx: "0.8.19", incur: "0.5.1" }],
  ])
    assert.throws(() => assertVersions(expected, observed), {
      message: "VERSION_MISMATCH",
    });
});
