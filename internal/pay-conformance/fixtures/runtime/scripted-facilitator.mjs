import assert from "node:assert/strict";
import { boot, certificates, body, json, listen, serveControl, send, counters, hash, network, organizationId, paymentId, requirements, transaction, block } from "./common.mjs";

try {
  const { config, modules } = await boot(async (config, load) => ({ viem: await load(config.native, "viem") }));
  const { viem } = modules, count = counters(), failures = [], events = [], effects = new Set();
  const supportedProtocols = [], supportArrivals = [];
  const protocolArrivals = [], protocolCounters = { x402: counters(), mpp: counters() };
  const realmPrivateArrivals = [];
  const wirePrivateArrivals = [];
  const rpcReads = [];
  const fulfillmentAttempts = [], settlementObservations = [];
  let settled, step;
  const types = { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] };
  async function authorization(wire) {
    const a = wire.command ? { from: wire.command.payer, to: wire.command.payTo, value: wire.command.amount, ...wire.command.authorization } : { ...wire.paymentPayload.payload.authorization, signature: wire.paymentPayload.payload.signature };
    const domain = a.domain ?? { name: "USDC", version: "2", chainId: 84532, verifyingContract: requirements.asset };
    assert.equal(a.to.toLowerCase(), requirements.payTo);
    assert.equal(a.value, "10000");
    const recovered = await viem.recoverTypedDataAddress({ domain, primaryType: "TransferWithAuthorization", types, message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce }, signature: a.signature });
    assert.equal(recovered.toLowerCase(), a.from.toLowerCase());
    return a;
  }
  function rpc(method, params) {
    assert.ok(settled && count.economicEffect === 1, "RPC_BEFORE_EFFECT");
    const a = settled, sig = viem.parseSignature(a.signature);
    const input = viem.encodeFunctionData({ abi: viem.parseAbi(["function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)"]), functionName: "transferWithAuthorization", args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, Number(sig.v ?? 27n + BigInt(sig.yParity)), sig.r, sig.s] });
    const topic = address => viem.pad(address, { size: 32 }).toLowerCase();
    const logs = [{ address: requirements.asset, topics: [viem.keccak256(viem.stringToHex("Transfer(address,address,uint256)")), topic(a.from), topic(a.to)], data: viem.toHex(BigInt(a.value), { size: 32 }) }, { address: requirements.asset, topics: [viem.keccak256(viem.stringToHex("AuthorizationUsed(address,bytes32)")), topic(a.from), a.nonce], data: "0x" }];
    if (method === "eth_chainId") { assert.deepEqual(params, []); return "0x14a34"; }
    const requested = step === "mismatch" && config.protocol === "mpp" || config.receiptCaseId === "wrong-receipt-transaction" && step !== "proof" ? "0x" + "ef".repeat(32) : transaction;
    if (method === "eth_getTransactionReceipt") { assert.deepEqual(params, [requested]); return { status: "0x1", transactionHash: transaction, blockHash: block, blockNumber: "0x100", logs: step === "rpc-mismatch" ? [] : logs }; }
    if (method === "eth_getTransactionByHash") { assert.deepEqual(params, [requested]); return { hash: transaction, to: requirements.asset, blockHash: block, input }; }
    assert.equal(method, "eth_getBlockByNumber"); assert.deepEqual(params, ["0x100", false]); return { hash: block };
  }
  function mutateProof(original, method) {
    let result = structuredClone(original), field = "none";
    if (step === "proof") return { result, field };
    const id = config.receiptCaseId, otherAddress = "0x2222222222222222222222222222222222222222";
    if (id === "wrong-chain" && method === "eth_chainId") { result = "0x2105"; field = "chainId"; }
    if (id === "wrong-contract" && method === "eth_getTransactionByHash") { result.to = otherAddress; field = "transaction.to"; }
    if (id === "failed-receipt" && method === "eth_getTransactionReceipt") { result.status = "0x0"; field = "receipt.status"; }
    if (id === "transaction-hash-mismatch" && method === "eth_getTransactionByHash") { result.hash = "0x" + "ef".repeat(32); field = "transaction.hash"; }
    if (id === "noncanonical-block" && method === "eth_getBlockByNumber") { result.hash = "0x" + "ef".repeat(32); field = "block.hash"; }
    if (id === "missing-transfer" && method === "eth_getTransactionReceipt") { result.logs.splice(0, 1); field = "receipt.logs.Transfer"; }
    if (id === "missing-authorization-used" && method === "eth_getTransactionReceipt") { result.logs.splice(1, 1); field = "receipt.logs.AuthorizationUsed"; }
    if (method === "eth_getTransactionByHash" && ["wrong-payer", "wrong-payee", "wrong-amount", "wrong-nonce", "wrong-validity", "wrong-call"].includes(id)) {
      if (id === "wrong-call") { result.input = "0x"; field = "transaction.input"; }
      else {
        const abi = viem.parseAbi(["function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)"]);
        const args = [...viem.decodeFunctionData({ abi, data: result.input }).args];
        const index = { "wrong-payer": 0, "wrong-payee": 1, "wrong-amount": 2, "wrong-validity": 4, "wrong-nonce": 5 }[id];
        field = "transaction.input." + { 0: "from", 1: "to", 2: "value", 4: "validBefore", 5: "nonce" }[index];
        args[index] = index < 2 ? otherAddress : index === 5 ? viem.toHex(BigInt(args[index]) ^ 1n, { size: 32 }) : args[index] + 1n;
        result.input = viem.encodeFunctionData({ abi, functionName: "transferWithAuthorization", args });
      }
    }
    if (field !== "none") assert.ok(JSON.stringify(original) !== JSON.stringify(result), "PROOF_MUTATION_MUST_CHANGE_VALUE");
    return { result, field };
  }
  const tls = await certificates(config.certificates);
  const listener = await listen(tls, async (request, response) => {
    // Count arrival before parsing body/JSON/stamp or authorization. Existing
    // verify/settle counters still mean successfully validated operations.
    const wireArrival = (config.wireCaseId || config.wireDecoderCaseId || config.authorizationCaseId) ? { stage: config.authorizationStage ?? config.wireDecoderStage ?? (step === "proof" ? "positive" : "negative"), operation: request.url === "/supported" ? "supported" : request.url === "/verify" ? "verify" : request.url === "/v1/settlements/charge" ? "charge" : request.url === `/v1/payments/${paymentId}/fulfillment` ? "fulfillment" : "other", atNs: process.hrtime.bigint().toString(), bodyReadAtNs: null, stampMetadataValidatedAtNs: null, authorizationValidatedAtNs: null, responseStatus: null, completedAtNs: null } : null;
    if (wireArrival) { wirePrivateArrivals.push(wireArrival); response.once("finish", () => { wireArrival.responseStatus = response.statusCode; wireArrival.completedAtNs = process.hrtime.bigint().toString(); }); }
    const realmArrival = config.realmCaseId && request.url !== "/rpc" ? { path: request.url, method: request.method, atNs: process.hrtime.bigint().toString(), wireProtocol: null } : null;
    if (realmArrival) realmPrivateArrivals.push(realmArrival);
    const realmStamp = realmArrival ? JSON.parse(Buffer.from(request.headers["x-stamp"], "base64url")) : null;
    if (realmArrival) realmArrival.wireProtocol = realmStamp.wireProtocol;
    const dualArrival = config.dualCaseId && request.url !== "/rpc" ? { path: request.url, method: request.method, atNs: process.hrtime.bigint().toString(), wireProtocol: null } : null;
    if (dualArrival) protocolArrivals.push(dualArrival);
    const bytes = await body(request);
    if (wireArrival) wireArrival.bodyReadAtNs = process.hrtime.bigint().toString();
    const wire = bytes.length ? JSON.parse(bytes) : undefined;
    if (request.url === "/rpc") {
      assert.equal(request.method, "POST"); assert.equal(wire.jsonrpc, "2.0"); assert.equal(request.headers["x-stamp"], undefined);
      count.rpc++; events.push({ event: "rpc", atNs: process.hrtime.bigint().toString() });
      if (step === "rpc-unavailable") { json(response, { error: "RPC_UNAVAILABLE" }, 503); return; }
      const original = rpc(wire.method, wire.params);
      if (step !== "proof" && ["rpc-unavailable", "rpc-invalid-response"].includes(config.receiptCaseId)) {
        const unavailable = config.receiptCaseId === "rpc-unavailable";
        const reply = unavailable ? { jsonrpc: "2.0", id: wire.id, result: original } : { jsonrpc: "2.0", id: wire.id };
        rpcReads.push({ method: wire.method, stage: "negative", resultSha256: hash(JSON.stringify(unavailable ? original : reply)), originalResultSha256: hash(JSON.stringify(original)), paramsSha256: hash(JSON.stringify(wire.params)), field: unavailable ? "response.status" : "response.envelope", responseStatus: unavailable ? 503 : 200 });
        json(response, reply, unavailable ? 503 : 200); return;
      }
      const { result, field } = config.receiptCaseId ? mutateProof(original, wire.method) : { result: original };
      if (config.receiptCaseId) rpcReads.push({ method: wire.method, stage: step === "proof" ? "proof" : "negative", resultSha256: hash(JSON.stringify(result)), originalResultSha256: hash(JSON.stringify(original)), paramsSha256: hash(JSON.stringify(wire.params)), field });
      if (config.offerCaseId) rpcReads.push({ method: wire.method, stage: "proof", resultSha256: hash(JSON.stringify(result)) });
      json(response, { jsonrpc: "2.0", id: wire.id, result }); return;
    }
    const stamp = realmStamp ?? JSON.parse(Buffer.from(request.headers["x-stamp"], "base64url"));
    if (dualArrival) dualArrival.wireProtocol = stamp.wireProtocol;
    const dualProtocol = dualArrival ? request.url.startsWith("/dual-x402/") ? "x402" : "mpp" : null;
    if (dualArrival) assert.ok(["/dual-x402/supported", "/dual-x402/verify", "/dual-x402/settle", "/dual-x402/v1/settlements/charge", "/dual-mpp/v1/settlements/charge"].includes(request.url));
    const auxiliaryDiscovery = config.freezeCaseId === "opposite-challenge-after-signature" && config.protocol === "mpp" && request.method === "GET" && request.url === "/base-sepolia/supported" || config.supportCaseId && request.method === "GET" && request.url === "/supported";
    assert.equal(stamp.version, "2"); assert.equal(stamp.organizationId, organizationId); assert.equal(stamp.wireProtocol, dualProtocol ?? (auxiliaryDiscovery ? "x402" : config.protocol));
    assert.equal(request.headers.authorization, undefined); assert.equal(request.headers["payment-signature"], undefined);
    if (wireArrival) wireArrival.stampMetadataValidatedAtNs = process.hrtime.bigint().toString();
    if (request.url.endsWith("/supported")) {
      count.supported++; assert.equal(request.method, "GET"); assert.equal(bytes.length, 0);
      if (dualProtocol) protocolCounters[dualProtocol].supported++;
      supportedProtocols.push(stamp.wireProtocol);
      if (config.supportCaseId) {
        assert.equal(request.url, "/supported");
        const fault = step !== "proof", timeout = fault && config.supportCaseId.endsWith("supported-timeout");
        const invalidJson = fault && (config.supportCaseId.endsWith("supported-invalid-json") || config.supportCaseId === "S-mpp-only-nondependency-positive");
        const reply = timeout ? null : invalidJson ? "{" : JSON.stringify(fault ? { kinds: "invalid", extensions: [], signers: {} } : { kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} });
        supportArrivals.push({ atNs: process.hrtime.bigint().toString(), wireProtocol: stamp.wireProtocol, responseStatus: timeout ? null : 200, responseKind: timeout ? "timeout" : invalidJson ? "invalid-json" : fault ? "invalid-shape" : "supported", responseSha256: reply === null ? null : hash(reply) });
        if (timeout) return; // Real accepted GET; the unchanged inner transport cancels it.
        response.writeHead(200, { "Content-Type": "application/json" }); response.end(reply); return;
      }
      json(response, { kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} }); return;
    }
    assert.equal(wire.organizationId, organizationId);
    if (request.url.endsWith("/fulfillment")) {
      count.fulfillment++; assert.equal(request.method, "PUT");
      const failed = config.sellerCaseId && step !== "proof" && ["handler-throws", "handler-500", "fulfillment-failed-after-handler-failure"].includes(config.sellerCaseId);
      assert.equal(wire.state, failed ? "FAILED" : "FULFILLED"); assert.equal(wire.failureCode, failed ? "HANDLER_ERROR" : undefined);
      assert.equal(request.url.endsWith(`/v1/payments/${paymentId}/fulfillment`), true);
      const fault = step !== "proof" && config.sellerCaseId?.startsWith("fulfillment-");
      const responseStatus = !fault ? 200 : ["fulfillment-disconnect", "fulfillment-timeout"].includes(config.sellerCaseId) ? null : config.sellerCaseId === "fulfillment-unexpected-2xx" ? 204 : 503;
      if (config.sellerCaseId) fulfillmentAttempts.push({ state: wire.state, failureCode: wire.failureCode ?? null, paymentIdSha256: hash(paymentId), atNs: process.hrtime.bigint().toString(), responseStatus, acknowledged: responseStatus === 200 });
      if (fault && config.sellerCaseId === "fulfillment-disconnect") { response.destroy(); return; }
      if (fault && config.sellerCaseId === "fulfillment-timeout") return; // Actual accepted PUT, no response, default internal five-second transport.
      response.writeHead(responseStatus); response.end(); return;
    }
    assert.equal(request.method, "POST");
    const a = await authorization(wire);
    if (wireArrival) wireArrival.authorizationValidatedAtNs = process.hrtime.bigint().toString();
    if (config.temporalValidityFinal) {
      const now = BigInt(Math.floor(Date.now() / 1000)), after = BigInt(a.validAfter), before = BigInt(a.validBefore);
      const valid = after < before && after <= now && now < before;
      if (!valid) {
        if (request.url.endsWith("/verify")) { count.verify++; json(response, { isValid: false, invalidReason: "authorization validity window rejected" }); return; }
        json(response, { errorCode: "PAYMENT_AUTH_FORBIDDEN", retryable: false }, 403); return;
      }
    }
    if (request.url.endsWith("/verify")) { count.verify++; if (dualProtocol) protocolCounters[dualProtocol].verify++; json(response, { isValid: true, payer: a.from }); return; }
    assert.ok(request.url.endsWith("/settle") || request.url.endsWith("/v1/settlements/charge"));
    count.settle++; events.push({ event: "settle", atNs: process.hrtime.bigint().toString() });
    if (dualProtocol) protocolCounters[dualProtocol].settle++;
    const effect = hash(JSON.stringify([network, requirements.asset, a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce]));
    if (config.verifySettleRejectionFinal && step === "rejected") {
      settlementObservations.push({ protocol: config.protocol, paymentIdSha256: hash(paymentId), economicSha256: effect, atNs: process.hrtime.bigint().toString() });
      if (config.verifySettleRejectionCaseId === "command-failed-result") {
        json(response, { settlement: { success: false, transaction: "", network }, paymentId }); return;
      }
      json(response, { errorCode: "PAYMENT_AUTH_FORBIDDEN", retryable: false, paymentId }, 403); return;
    }
    if (["signed-500", "signed-502", "signed-599"].includes(step)) { json(response, { errorCode: "PAYMENT_SERVICE_UNAVAILABLE", retryable: true, paymentId }, Number(step.slice(7))); return; }
    if (!effects.has(effect)) { effects.add(effect); count.economicEffect++; if (dualProtocol) protocolCounters[dualProtocol].economicEffect++; }
    settled = a;
    if (["unknown", "accepted-503"].includes(step)) { json(response, { errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true, paymentId }, 503); return; }
    if (step === "rejected") { json(response, { errorCode: "PAYMENT_AUTH_FORBIDDEN", retryable: false, paymentId }, 403); return; }
    if (["disconnect", "accepted-disconnect"].includes(step)) { response.destroy(); return; }
    if (["timeout", "accepted-timeout"].includes(step)) return; // The owned transport's deadline closes this socket.
    if (config.sellerCaseId) settlementObservations.push({ protocol: config.protocol, paymentIdSha256: hash(paymentId), economicSha256: effect, atNs: process.hrtime.bigint().toString() });
    json(response, { settlement: { success: true, transaction, network, payer: a.from }, paymentId });
  }, failure => failures.push(failure));
  send({ type: "ready", port: listener.port });
  await serveControl(listener.server, () => ({ counters: count, failures, events, ...((config.wireCaseId || config.wireDecoderCaseId || config.authorizationCaseId) ? { wirePrivateArrivals } : {}), ...(config.freezeCaseId ? { supportedProtocols } : {}), ...(config.receiptCaseId || config.offerCaseId ? { rpcReads } : {}), ...(config.sellerCaseId ? { fulfillmentAttempts, settlementObservations } : {}), ...(config.supportCaseId ? { supportArrivals } : {}), ...(config.dualCaseId ? { protocolArrivals, protocolCounters } : {}), ...(config.realmCaseId ? { realmPrivateArrivals } : {}) }), value => { step = value; });
} catch (error) {
  send({ type: "failure", messageSha256: hash(String(error?.message)) }); process.exitCode = 1;
  if (process.connected) process.disconnect();
}
