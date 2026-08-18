import assert from "node:assert/strict";
import { corruptBase64urlBytes } from "./tamper.js";

const characterMutationSource = "AA";
const characterMutation = "AB";
assert.deepEqual(
  Buffer.from(characterMutation, "base64url"),
  Buffer.from(characterMutationSource, "base64url"),
  "changing base64url padding bits does not always change decoded bytes",
);

const ciphertext = Buffer.from([0x00, 0x10, 0xff]).toString("base64url");
const corrupted = corruptBase64urlBytes(ciphertext);
assert.deepEqual(
  Buffer.from(corrupted, "base64url"),
  Buffer.from([0x01, 0x10, 0xff]),
);
assert.notEqual(corrupted, ciphertext);

process.stdout.write("Pay UAT ciphertext tamper checks passed.\n");
