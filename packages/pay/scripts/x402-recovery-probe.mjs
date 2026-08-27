import https from "node:https";
import net from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createECDH, randomBytes } from "node:crypto";
import { publicModule, makeServer, tlsFetch, check, hash, network, organizationId, paymentId, requirements, transaction, block } from "./x402-boundary-runtime.mjs";
const [payApp, consumerApp, tlsDir, directory] = process.argv.slice(2);
mkdirSync(directory, { mode: 0o700 });
writeFileSync(join(directory, "storage.key"), randomBytes(32), { flag: "wx", mode: 0o600 });
writeFileSync(join(directory, "signer.key"), "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", { flag: "wx", mode: 0o600 });
const key = readFileSync(join(tlsDir, "loopback-server-v2.key")), cert = readFileSync(join(tlsDir, "loopback-server-v2.pem")), ca = readFileSync(join(tlsDir, "loopback-ca-v2.pem"));
const inventory = [], events = [], children = [], servers = [], allowed = new Set();
const emit = (type, fields = {}) => { const event = { seq: events.length + 1, type, atNs: process.hrtime.bigint().toString(), ...fields }; events.push(event); console.log(JSON.stringify(event)); };
const sdk = await publicModule(payApp, "@0xkey-io/pay/x402", "require", inventory);
const producerCore = await publicModule(payApp, "@x402/core/server", "require", inventory);
const core = await publicModule(consumerApp, "@x402/core/server", "require", inventory);
const evm = await publicModule(consumerApp, "@x402/evm/exact/server", "require", inventory);
const codec = await publicModule(consumerApp, "@x402/core/http", "require", inventory);
const framework = await publicModule(consumerApp, "@x402/express", "require", inventory);
const express = await publicModule(consumerApp, "express", "require", inventory);
const viem = await publicModule(payApp, "viem", "require", inventory);
check(framework.x402HTTPResourceServer === core.x402HTTPResourceServer, "framework-owner");
const counts = { supported: 0, verify: 0, settle: 0, broadcasts: 0, handler: 0, rpc: 0, challenge: 0 };
let stage = "unknown", signed, credentialHash, backend, merchant, serverFailed = false;
const requestHashes = [], signedHeaders = [], rpcMethods = [];
const transport = tlsFetch(ca, allowed);
globalThis.fetch = async () => { throw new Error("unexpected-global-egress"); };
const body = async req => { let n = 0; const chunks = []; for await (const chunk of req) { n += chunk.length; check(n <= 65536, "body-bound"); chunks.push(chunk); } return Buffer.concat(chunks); };
const json = (res, value, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
async function listen(handler, role) {
  const server = https.createServer({ key, cert }, async (req, res) => {
    if (req.url === "/health") { res.writeHead(200); res.end("boundary-tls"); return; }
    try { await handler(req, res); } catch { serverFailed = true; emit("server-failure", { role }); res.writeHead(500); res.end("fixture-failure"); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  server.listen(0, "127.0.0.1"); await once(server, "listening"); servers.push(server);
  const port = server.address().port, origin = `https://127.0.0.1:${port}`; allowed.add(origin); emit("listen", { role, port }); return origin;
}
function rpc(method, params) {
  check(signed && counts.broadcasts === 1 && counts.handler > 0, "rpc-after-economic-success");
  const { authorization: a, signature } = signed.payload;
  const sig = viem.parseSignature(signature);
  const input = viem.encodeFunctionData({ abi: viem.parseAbi(["function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)"]), functionName: "transferWithAuthorization", args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, Number(sig.v ?? 27n + BigInt(sig.yParity)), sig.r, sig.s] });
  const topic = address => viem.pad(address, { size: 32 }).toLowerCase();
  const logs = [{ address: requirements.asset, topics: [viem.keccak256(viem.stringToHex("Transfer(address,address,uint256)")), topic(a.from), topic(a.to)], data: viem.toHex(BigInt(a.value), { size: 32 }) }, { address: requirements.asset, topics: [viem.keccak256(viem.stringToHex("AuthorizationUsed(address,bytes32)")), topic(a.from), a.nonce], data: "0x" }];
  if (method === "eth_chainId") { check(params.length === 0, "chain-params"); return "0x14a34"; }
  if (method === "eth_getTransactionReceipt") { check(params[0] === transaction, "receipt-params"); return { status: "0x1", transactionHash: transaction, blockHash: block, blockNumber: "0x100", logs }; }
  if (method === "eth_getTransactionByHash") { check(params[0] === transaction, "tx-params"); return { hash: transaction, to: requirements.asset, blockHash: block, input }; }
  if (method === "eth_getBlockByNumber") { check(params[0] === "0x100" && params[1] === false, "block-params"); return { hash: block }; }
  throw new Error("unexpected-rpc");
}
async function child(stageName) {
  const argv = [join(import.meta.dirname, "x402-recovery-buyer.mjs"), payApp, tlsDir, directory, merchant, backend, stageName];
  const processChild = spawn(process.execPath, argv, { env: process.env, stdio: ["ignore", "pipe", "pipe"] }); children.push(processChild);
  let output = "", errors = "", bytes = 0, lines = "";
  const childEvents = [];
  const timer = setTimeout(() => processChild.kill("SIGKILL"), 20000);
  for (const [stream, which] of [[processChild.stdout, "out"], [processChild.stderr, "err"]]) stream.on("data", chunk => {
    bytes += chunk.length;
    if (bytes > 131072) processChild.kill("SIGKILL");
    else if (which === "out") {
      output += chunk; lines += chunk;
      for (;;) {
        const end = lines.indexOf("\n"); if (end < 0) break;
        const event = JSON.parse(lines.slice(0, end)); lines = lines.slice(end + 1);
        childEvents.push(event); emit("buyer-event", event);
      }
    } else errors += chunk;
  });
  const [code, signal] = await once(processChild, "close"); clearTimeout(timer);
  writeFileSync(join(directory, stageName + ".stdout"), output, { flag: "wx", mode: 0o600 });
  writeFileSync(join(directory, stageName + ".stderr"), errors, { flag: "wx", mode: 0o600 });
  emit("child-exit", { stage: stageName, pid: processChild.pid, code, signal, stdoutSha256: hash(output), stderrSha256: hash(errors) });
  check(code === 0 && errors.length === 0, "buyer-child-failed");
  check(lines.length === 0, "complete-child-events");
  return childEvents;
}
try {
  emit("inventory", { inventory, mode: "configured", producerCondition: "require", consumerCondition: "require", sameOwner: producerCore.FacilitatorResponseError === core.FacilitatorResponseError, realChain: false });
  backend = await listen(async (req, res) => {
    const raw = await body(req), wire = raw.length ? JSON.parse(raw) : undefined;
    if (req.url === "/rpc") {
      check(req.method === "POST" && wire.jsonrpc === "2.0" && !req.headers["x-stamp"], "rpc-shape");
      counts.rpc++; rpcMethods.push(wire.method); emit("rpc", { stage, method: wire.method });
      if (stage === "rpc") { json(res, { error: "synthetic RPC unavailable" }, 503); return; }
      json(res, { jsonrpc: "2.0", id: wire.id, result: rpc(wire.method, wire.params) }); return;
    }
    check(typeof req.headers["x-stamp"] === "string" && !req.headers.authorization && !req.headers["payment-signature"], "private-carriers");
    const stamp = JSON.parse(Buffer.from(req.headers["x-stamp"], "base64url"));
    check(stamp.version === "2" && stamp.organizationId === organizationId && stamp.wireProtocol === "x402", "xstamp-envelope");
    if (req.url === "/supported") { counts.supported++; check(req.method === "GET" && raw.length === 0, "supported-shape"); emit("supported"); json(res, { kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} }); return; }
    check(req.url === "/settle" && req.method === "POST", "unexpected-private-operation"); counts.settle++;
    check(Object.keys(wire).sort().join() === "organizationId,paymentPayload,paymentRequirements,x402Version" && wire.organizationId === organizationId && wire.x402Version === 2, "private-envelope");
    check(hash(JSON.stringify(wire.paymentPayload)) === hash(JSON.stringify(signed)) && JSON.stringify(wire.paymentRequirements) === JSON.stringify(signed.accepted), "wire-continuity");
    const a = signed.payload.authorization;
    check(a.value === "10000" && a.to.toLowerCase() === requirements.payTo && signed.accepted.network === network && signed.accepted.asset.toLowerCase() === requirements.asset.toLowerCase() && signed.accepted.extra.paymentFlow === "upfront" && signed.accepted.extra.assetTransferMethod === "eip3009", "fixed-profile");
    const recovered = await viem.recoverTypedDataAddress({ domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: requirements.asset }, types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] }, primaryType: "TransferWithAuthorization", message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) }, signature: signed.payload.signature });
    check(recovered.toLowerCase() === a.from.toLowerCase(), "actual-signature-proof");
    requestHashes.push(hash(raw)); emit("settle", { stage, attempt: counts.settle, envelopeSha256: hash(raw), cryptographicSignatureValid: true });
    if (stage === "unknown") { check(counts.handler === 0, "no-handler-before-unknown"); json(res, { errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true, paymentId }, 503); return; }
    if (counts.broadcasts === 0) counts.broadcasts++; // Synthetic idempotent economic effect, not a real broadcast.
    json(res, { settlement: { success: true, transaction, network, payer: a.from }, paymentId });
  }, "facilitator-rpc");
  const ec = createECDH("prime256v1"); ec.setPrivateKey(Buffer.from("01".padStart(64, "0"), "hex"));
  const client = sdk.create0xkeyFacilitatorClient({ network, organizationId, apiKey: { publicKey: ec.getPublicKey("hex", "compressed"), privateKey: ec.getPrivateKey("hex").padStart(64, "0") }, facilitatorUrl: backend, fetch: transport, facilitatorResponseError: core.FacilitatorResponseError, timeoutMs: 2000 });
  const http = makeServer(core, evm, client);
  const app = express();
  app.use((req, res, next) => {
    if (req.headers["payment-signature"]) {
      const header = req.headers["payment-signature"]; const digest = hash(header); credentialHash ??= digest; check(digest === credentialHash, "byte-identical-credential");
      signed = codec.decodePaymentSignatureHeader(header); signedHeaders.push(digest); emit("signed-receive", { stage, credentialSha256: digest });
    } else { counts.challenge++; emit("unsigned-request"); }
    res.on("finish", () => emit("merchant-response", { stage, status: res.statusCode, handler: counts.handler })); next();
  });
  app.use(framework.paymentMiddlewareFromHTTPServer(http));
  app.get("/paid", (_req, res) => { check(counts.broadcasts === 1 && stage !== "unknown", "handler-after-settlement"); counts.handler++; emit("handler", { stage, settleAttempts: counts.settle }); res.json({ paid: true }); });
  // Corrupt only the successful public receipt in the separately named fault;
  // do not rewrite dependency errors or status codes.
  merchant = await listen((req, res) => {
    if (stage === "malformed" || stage === "mismatch") {
      const setHeader = res.setHeader;
      res.setHeader = function(name, value) {
        if (name.toLowerCase() === "payment-response") value = stage === "malformed" ? "malformed" : codec.encodePaymentResponseHeader({ ...codec.decodePaymentResponseHeader(value), network: "eip155:8453" });
        return setHeader.call(this, name, value);
      };
    }
    app(req, res);
  }, "official-express");
  for (const origin of [backend, merchant]) {
    check((await transport(origin + "/health")).status === 200, "trusted-ca");
    const wrong = tlsFetch(readFileSync(join(tlsDir, "unrelated-ca-v2.pem")), allowed);
    let code; try { await wrong(origin + "/health"); } catch (error) { code = error.code; }
    check(code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "wrong-ca-rejected"); emit("tls-control", { origin, trusted: true, wrongCA: code });
  }
  const all = []; let initialCiphertext;
  for (stage of ["unknown", "malformed", "mismatch", "rpc", "proof"]) {
    const before = counts.settle; const result = await child(stage); all.push(...result);
    check(counts.settle === before + 1, "no-resettle-echo");
    if (stage !== "proof") {
      const digest = hash(readFileSync(join(directory, "pending.aead"))); initialCiphertext ??= digest; check(digest === initialCiphertext, "pending-byte-retention");
      emit("pending-retained", { stage, ciphertextSha256: digest });
    }
  }
  check(all.filter(e => e.type === "cryptographic-signature").length === 1 && all.filter(e => e.type === "save").length === 1 && all.filter(e => e.type === "clear").length === 1, "one-sign-save-clear");
  check(signedHeaders.length === 5 && new Set(signedHeaders).size === 1 && new Set(requestHashes).size === 1, "frozen-retry");
  check(counts.supported === 1 && counts.verify === 0 && counts.settle === 5 && counts.broadcasts === 1 && counts.handler === 4 && counts.challenge === 1 && counts.rpc === 7, "call-counts");
  const ordered = events.toSorted((a, b) => BigInt(a.atNs) < BigInt(b.atNs) ? -1 : 1);
  const position = (type, whichStage) => ordered.findIndex(e => e.type === type && (!whichStage || e.stage === whichStage));
  check(position("cryptographic-signature") < position("save") && position("save") < position("signed-send") && position("signed-send") < position("signed-receive") && position("signed-receive") < position("settle"), "save-before-send-order");
  check(position("settle", "proof") < position("handler", "proof") && position("handler", "proof") < position("rpc", "proof") && ordered.filter(e => e.type === "rpc" && e.stage === "proof").every(e => BigInt(e.atNs) < BigInt(ordered[position("clear")].atNs)), "proof-before-clear-order");
  check(!existsSync(join(directory, "pending.aead")) && !serverFailed, "final-state");
  emit("PASS", { counts, rpcMethods, sameCredential: true, defaultReceiptVerifier: true, freshBuyerProcesses: 5, realChain: false });
} finally {
  for (const childProcess of children) if (childProcess.exitCode === null && childProcess.signalCode === null) { childProcess.kill("SIGKILL"); await once(childProcess, "close"); }
  for (const server of servers) { const port = server.address().port; server.closeAllConnections(); await new Promise(done => server.close(done)); const probe = net.createServer(); probe.listen(port, "127.0.0.1"); await once(probe, "listening"); await new Promise(done => probe.close(done)); emit("closed", { port }); }
  const text = JSON.stringify(events); check(!text.includes(readFileSync(join(directory, "signer.key"), "utf8")) && !text.includes(readFileSync(join(directory, "storage.key")).toString("hex")) && (!signed || !text.includes(signed.payload.signature)), "secret-output-scan");
}
