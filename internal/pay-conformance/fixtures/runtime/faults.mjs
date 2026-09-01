import { mkdir, readFile, writeFile, copyFile, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { nativeScenario } from "./scenario.mjs";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { redactOutput,deleteRawOutput } from "../../src/redact.mjs";
import { initializeStore, durableStore } from "./durable-store.mjs";
import { counters, hash, publicModule, certificates, listen, body, json, tlsFetch, network, organizationId, requirements, transaction, paymentId } from "./common.mjs";
import { freezeCaseIds, receiptCases, offerCases, offerCaseProtocols, sellerCases, supportCaseIds, preflightCases, dualCaseIds, wireCases, currentX402UnsupportedAuthorizationCases, currentX402AmountMismatchCases, currentX402AssetMismatchCases, currentX402PayeeMismatchCases, currentMppPayeeMismatchCases, currentMppAmountMismatchCases, currentMppAssetMismatchCases, currentMppUnsupportedAuthorizationCases, currentSupportedFailureCases, currentStandardWireReceiptCases, currentTemporalValidityCases, currentReplayCases, currentVerifySettleRejectionCases, currentSettleUnknownCases, currentProtocolFreezeCases, currentRedactionCases } from "../../src/ipc.mjs";

const directX402Payload = Object.freeze({ x402Version: 2, accepted: requirements, payload: Object.freeze({ signature: "0x" + "11".repeat(65), authorization: Object.freeze({ from: "0x2222222222222222222222222222222222222222", to: requirements.payTo, value: "10000", validAfter: "0", validBefore: "9999999999", nonce: "0x" + "22".repeat(32) }) }) });

async function directX402RejectionSubcase({ input, directory, caseId, condition, profile, assert, onReady }) {
  await mkdir(directory, { mode: 0o700 });
  const inventory = [], count = counters(), failures = [];
  const sdk = await publicModule(input.consumer.directory, "@0xkey-io/pay/x402", condition, inventory);
  const core = await publicModule(input.native, "@x402/core/server", condition, inventory);
  const tls = await certificates(input.certificates);
  let arrival = null;
  const listener = await listen(tls, async (request, response) => {
    const bytes = await body(request), operation = request.url.slice(1);
    assert.ok(["verify", "settle"].includes(operation)); assert.equal(request.method, "POST");
    const envelope = JSON.parse(bytes); assert.equal(envelope.organizationId, organizationId); assert.equal(envelope.x402Version, 2);
    count[operation]++; arrival = { operation, requestSha256: hash(bytes), responseStatus: null };
    if (caseId.endsWith("4xx")) { arrival.responseStatus = 403; json(response, { errorCode: "PAYMENT_AUTH_FORBIDDEN", retryable: false }, 403); return; }
    if (operation === "verify") { arrival.responseStatus = 200; json(response, { isValid: caseId === "verify-positive", ...(caseId === "verify-positive" ? { payer: directX402Payload.payload.authorization.from } : { invalidReason: "authorization rejected" }) }); return; }
    arrival.responseStatus = 200; json(response, { settlement: { success: false, transaction: "", network, payer: directX402Payload.payload.authorization.from, errorReason: "authorization rejected" }, paymentId });
  }, failure => failures.push(failure));
  onReady(listener.port);
  let outcome, nativeOwner = false, code = null;
  try {
    const client = sdk.create0xkeyFacilitatorClient({ network, organizationId, facilitatorUrl: listener.origin, facilitatorResponseError: core.FacilitatorResponseError, stamper: { async stampRequest() { return { stampHeaderName: "X-Stamp", stampHeaderValue: "synthetic" }; } }, fetch: tlsFetch(tls.ca, new Set([listener.origin])) });
    const operation = caseId.startsWith("verify-") ? "verify" : "settle";
    try {
      const result = await client[operation](directX402Payload, requirements);
      outcome = caseId === "verify-positive" ? "verified" : "deterministic-rejection";
      assert.equal(operation === "verify" ? result.isValid : result.success, caseId === "verify-positive");
    } catch (error) {
      nativeOwner = error instanceof core.FacilitatorResponseError; code = error?.cause?.code ?? null; outcome = "native-owner-error";
      assert.equal(caseId.endsWith("4xx"), true); assert.equal(nativeOwner, true);
      assert.equal(code, operation === "verify" ? "PAYMENT_SERVICE_UNAVAILABLE" : "PAYMENT_AUTH_FORBIDDEN");
    }
    assert.deepEqual(failures, []); assert.ok(arrival); assert.equal(count.handler, 0); assert.equal(count.applicationEffect, 0);
  } finally {
    listener.server.closeAllConnections(); await new Promise(resolve => listener.server.close(resolve));
  }
  const result = { path: "direct", caseId, condition, status: "PASSED", owner: profile.owner, inventory, counters: count, outcome, nativeOwner, code, arrival };
  await writeFile(join(directory, "direct.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return result;
}

async function sellerRejectionSubcase({ input, directory, caseId, condition, profile, assert, onReady }) {
  await mkdir(directory, { mode: 0o700 });
  const path = caseId === "settlement-rejected-no-handler" ? "seller" : "method";
  const config = { condition, protocol: profile.protocol, payBuyer: false, native: input.native, pay: input.consumer.directory, certificates: input.certificates, sellerCaseId: "handler-200", verifySettleRejectionFinal: true, verifySettleRejectionCaseId: caseId };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  let buyerResult, merchantSnapshot, facilitatorSnapshot, failure;
  try {
    const facilitator = await spawnRole("scripted-facilitator"), merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
    facilitator.send({ type: "configure", step: "rejected" }); assert.equal((await facilitator.take("configured")).step, "rejected");
    const buyer = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin });
    buyerResult = await buyer.take("seller-result"); assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
    merchant.send({ type: "snapshot" }); merchantSnapshot = await merchant.take("snapshot");
    facilitator.send({ type: "snapshot" }); facilitatorSnapshot = await facilitator.take("snapshot");
    assert.equal([402, 403].includes(buyerResult.status), true); assert.equal(buyerResult.receiptSha256, null); assert.equal(buyerResult.receiptValid, false);
    assert.deepEqual([merchantSnapshot.counters.handler, merchantSnapshot.counters.applicationEffect], [0, 0]);
    assert.deepEqual([facilitatorSnapshot.counters.settle, facilitatorSnapshot.counters.economicEffect, facilitatorSnapshot.counters.fulfillment], [1, 0, 0]);
    assert.deepEqual(merchantSnapshot.received.length, 1); assert.deepEqual(merchantSnapshot.failures, []); assert.deepEqual(facilitatorSnapshot.failures, []);
    await scenario.closeRoles([merchant, facilitator]);
  } catch (error) { failure = hash(String(error?.message)); }
  const diagnostics = await scenario.cleanup();
  if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
  if (failure) throw new Error("SELLER_REJECTION_SUBCASE_FAILED");
  const total = counters(); for (const value of [buyerResult, merchantSnapshot, facilitatorSnapshot]) for (const key of Object.keys(total)) total[key] += value.counters[key];
  const inventory = roles.flatMap(role => role.identity.inventory);
  const result = { path, caseId, condition, status: "PASSED", owner: profile.owner, inventory, counters: total, outcome: caseId === "owner-rejected" || caseId === "command-4xx" ? "native-owner-error" : "deterministic-rejection", roles: roles.map(role => role.identity), ports, tls: tlsControls, diagnostics };
  await writeFile(join(directory, "seller-rejection.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return result;
}

async function directMppMethodRejectionSubcase({ input, directory, caseId, condition, profile, assert }) {
  await mkdir(directory, { mode: 0o700 });
  const inventory = [], count = counters();
  const pay = await publicModule(input.consumer.directory, "@0xkey-io/pay/mpp", condition, inventory);
  const native = await publicModule(input.native, "mppx", condition, inventory);
  const server = await publicModule(input.native, "mppx/server", condition, inventory);
  const evm = await publicModule(input.native, "mppx/evm", condition, inventory);
  const accounts = await publicModule(input.native, "viem/accounts", condition, inventory);
  const account = accounts.privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  const fetch = async () => {
    count.settle++;
    if (caseId === "command-failed-result") return Response.json({ settlement: { success: false, transaction: "", network }, paymentId });
    return Response.json({ errorCode: "PAYMENT_AUTH_FORBIDDEN", retryable: false, paymentId }, { status: 403 });
  };
  const method = pay.create0xkeyEvmChargeMethod({ network, organizationId, payTo: requirements.payTo, facilitatorUrl: "https://fixture.invalid", stamper: { async stampRequest() { return { stampHeaderName: "X-Stamp", stampHeaderValue: "synthetic" }; } }, fetch, paymentError: native.Errors.PaymentError });
  const route = server.Mppx.create({ methods: [method], secretKey: randomBytes(32).toString("hex") }).evm.charge({ amount: "0.01" });
  const initial = await route(new Request("https://merchant.invalid/paid")); assert.equal(initial.status, 402);
  const challenge = native.Challenge.fromResponse(initial.challenge);
  const nonce = evm.challengeHash(challenge), validBefore = String(Math.floor(Date.now() / 1000) + 300);
  count.sign++;
  const signature = await account.signTypedData({ domain: evm.authorizationDomain({ authorization: { name: "USDC", version: "2" }, chainId: 84532, currency: challenge.request.currency }), message: { from: account.address, nonce, to: challenge.request.recipient, validAfter: 0n, validBefore: BigInt(validBefore), value: BigInt(challenge.request.amount) }, primaryType: "TransferWithAuthorization", types: evm.authorizationTypes });
  const encoded = native.Credential.serialize({ challenge, payload: { from: account.address, nonce, signature, to: challenge.request.recipient, type: "authorization", validAfter: "0", validBefore, value: challenge.request.amount } });
  const credential = native.Credential.deserialize(encoded); count.signedSend++;
  let error; try { await method.verify({ credential }); } catch (cause) { error = cause; }
  assert.ok(error instanceof native.Errors.PaymentError); assert.equal(error.status, caseId === "command-failed-result" ? 402 : 403);
  assert.equal(count.settle, 1); assert.equal(count.handler, 0); assert.equal(count.economicEffect, 0); assert.equal(count.applicationEffect, 0);
  const result = { path: "method", caseId, condition, status: "PASSED", owner: profile.owner, inventory, counters: count, outcome: caseId === "command-failed-result" ? "deterministic-rejection" : "native-owner-error", error: { nativeInstance: true, status: error.status, problemSha256: hash(JSON.stringify(error.toProblemDetails())) }, credentialSha256: hash(encoded) };
  await writeFile(join(directory, "method-rejection.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return result;
}

export async function runCurrentVerifySettleRejection({ input, row, directory, assert, onReady, profile }) {
  if (input.stage !== "final-7b" || row !== profile.row || profile.catalog !== currentVerifySettleRejectionCases[profile.protocol]) throw new Error("VERIFY_SETTLE_REJECTION_PROFILE_REJECTED");
  const subcases = [];
  if (profile.protocol === "x402") for (const caseId of profile.catalog.direct) for (const condition of ["import", "require"]) subcases.push(await directX402RejectionSubcase({ input, directory: join(directory, `direct-${caseId}-${condition}`), caseId, condition, profile, assert, onReady }));
  for (const [path, caseIds] of Object.entries(profile.catalog).filter(([path]) => path !== "direct")) for (const caseId of caseIds) for (const condition of ["import", "require"]) subcases.push(path === "method" ? await directMppMethodRejectionSubcase({ input, directory: join(directory, `${path}-${caseId}-${condition}`), caseId, condition, profile, assert }) : await sellerRejectionSubcase({ input, directory: join(directory, `${path}-${caseId}-${condition}`), caseId, condition, profile, assert, onReady }));
  return subcases;
}

async function settleUnknownBuyerSequence({ input, directory, condition, profile, assert, onReady }) {
  await mkdir(directory, { mode: 0o700 }); const config = { condition, protocol: profile.protocol, payBuyer: true, native: input.native, pay: input.consumer.directory, certificates: input.certificates };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  const subcases = []; let failure, credentialSha256, recordSha256, activeStep = "setup";
  try {
    const facilitator = await spawnRole("scripted-facilitator"), merchant = await spawnRole("merchant", { facilitator: facilitator.origin }); onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
    const store = join(directory, "durable"); initializeStore(store);
    for (const step of ["settle-unknown-capture", ...profile.catalog.buyer]) {
      activeStep = step;
      for (const role of [facilitator, merchant]) { role.send({ type: "configure", step }); assert.equal((await role.take("configured")).step, step); }
      const buyer = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store, step, settleUnknownFinal: true });
      let result, termination;
      if (step === "settle-unknown-capture") { result = await buyer.take("prepared"); buyer.child.kill("SIGKILL"); termination = await buyer.close; assert.equal(termination.signal, "SIGKILL"); credentialSha256 = result.credentialSha256; recordSha256 = result.recordSha256; continue; }
      result = await buyer.take("completed"); assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
      assert.equal(result.credentialSha256, credentialSha256); assert.equal(result.recordSha256, recordSha256); assert.equal(result.pending, step !== "verified-resume");
      subcases.push({ path: "buyer", caseId: step, condition, status: "PASSED", owner: profile.owner, inventory: buyer.identity.inventory, counters: result.counters, outcome: step === "verified-resume" ? "verified" : "safe-pending", credentialSha256, recordSha256, errorCode: result.errorCode, responseStatus: result.status });
    }
    const snapshots=[]; for (const role of [merchant, facilitator]) { role.send({type:"snapshot"}); snapshots.push(await role.take("snapshot")); } assert.deepEqual(snapshots.flatMap(s=>s.failures), []); assert.equal(snapshots[0].counters.handler, 1); assert.equal(snapshots[1].counters.economicEffect, 1); await scenario.closeRoles([merchant,facilitator]);
  } catch (error) { failure=hash(String(error?.message)); }
  const diagnostics=await scenario.cleanup(); if (diagnostics.some(r=>r.stdout.bytes||r.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT"); if (failure) throw new Error(`SETTLE_UNKNOWN_BUYER_SEQUENCE_FAILED:${activeStep}:${failure}`);
  return subcases.map(value=>({...value,ports,tls:tlsControls,diagnostics}));
}

async function settleUnknownSeller({ input, directory, condition, profile, assert, onReady }) {
  await mkdir(directory,{mode:0o700}); const config={condition,protocol:profile.protocol,payBuyer:false,native:input.native,pay:input.consumer.directory,certificates:input.certificates,sellerCaseId:"handler-200"}; const scenario=nativeScenario({config,assert}),{roles,ports,tlsControls,spawnRole}=scenario; let failure,buyerResult,merchantSnapshot,facilitatorSnapshot;
  try { const facilitator=await spawnRole("scripted-facilitator"),merchant=await spawnRole("merchant",{facilitator:facilitator.origin}); onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator,merchant]); for(const role of [facilitator,merchant]){role.send({type:"configure",step:"accepted-503"});assert.equal((await role.take("configured")).step,"accepted-503");} const buyer=await spawnRole("buyer",{facilitator:facilitator.origin,merchant:merchant.origin,step:"accepted-503",payBuyer:false,settleUnknownFinal:true}); buyerResult=await buyer.take("seller-result"); assert.deepEqual(await buyer.close,{code:0,signal:null,reason:null}); merchant.send({type:"snapshot"});merchantSnapshot=await merchant.take("snapshot");facilitator.send({type:"snapshot"});facilitatorSnapshot=await facilitator.take("snapshot"); assert.equal(buyerResult.status,503); assert.deepEqual([merchantSnapshot.counters.handler,merchantSnapshot.counters.applicationEffect],[0,0]); assert.deepEqual([facilitatorSnapshot.counters.settle,facilitatorSnapshot.counters.economicEffect],[1,1]); await scenario.closeRoles([merchant,facilitator]); } catch(error){failure=hash(String(error?.message));}
  const diagnostics=await scenario.cleanup();if(diagnostics.some(r=>r.stdout.bytes||r.stderr.bytes))failure??=hash("UNEXPECTED_ROLE_OUTPUT");if(failure)throw new Error("SETTLE_UNKNOWN_SELLER_FAILED"); const total=counters();for(const value of [buyerResult,merchantSnapshot,facilitatorSnapshot])for(const key of Object.keys(total))total[key]+=value.counters[key]; return {path:"seller",caseId:"unknown-no-handler",condition,status:"PASSED",owner:profile.owner,inventory:roles.flatMap(r=>r.identity.inventory),counters:total,outcome:"unknown-no-handler",ports,tls:tlsControls,diagnostics};
}

async function settleUnknownOwner({ input, directory, condition, caseId, profile, assert }) {
  await mkdir(directory,{mode:0o700}); const inventory=[], count=counters();
  if(profile.protocol==="x402") { const pay=await publicModule(input.consumer.directory,"@0xkey-io/pay/x402",condition,inventory),core=await publicModule(input.native,"@x402/core/server",condition,inventory),tls=await certificates(input.certificates); const listener=await listen(tls,async(req,res)=>{await body(req);count.settle++;json(res,{errorCode:"PAYMENT_STATUS_UNKNOWN",retryable:true,paymentId},503);}); let error;try{const client=pay.create0xkeyFacilitatorClient({network,organizationId,facilitatorUrl:listener.origin,facilitatorResponseError:core.FacilitatorResponseError,stamper:{async stampRequest(){return{stampHeaderName:"X-Stamp",stampHeaderValue:"synthetic"};}},fetch:tlsFetch(tls.ca,new Set([listener.origin]))});await client.settle(directX402Payload,requirements);}catch(cause){error=cause;}finally{listener.server.closeAllConnections();await new Promise(resolve=>listener.server.close(resolve));} assert.ok(error instanceof core.FacilitatorResponseError); return {path:"owner",caseId,condition,status:"PASSED",owner:profile.owner,inventory,counters:count,outcome:"native-owner-unknown",ownerEquality:true}; }
  const pay=await publicModule(input.consumer.directory,"@0xkey-io/pay/mpp",condition,inventory), selected=await publicModule(input.native,"mppx",condition,inventory), selectedServer=await publicModule(input.native,"mppx/server",condition,inventory), selectedEvm=await publicModule(input.native,"mppx/evm",condition,inventory), accounts=await publicModule(input.native,"viem/accounts",condition,inventory), current=await publicModule(input.consumer.directory,"mppx",condition,inventory); const configured=caseId==="default-current-same-owner"?undefined:caseId==="configured-foreign-selected-owner"?selected.Errors.PaymentError:current.Errors.PaymentError; const options={network,organizationId,payTo:requirements.payTo,facilitatorUrl:"https://fixture.invalid",stamper:{async stampRequest(){return{stampHeaderName:"X-Stamp",stampHeaderValue:"synthetic"};}},fetch:async()=>{count.settle++;return Response.json({errorCode:"PAYMENT_STATUS_UNKNOWN",retryable:true,paymentId},{status:503});},...(configured?{paymentError:configured}:{})}; const method=pay.create0xkeyEvmChargeMethod(options),route=selectedServer.Mppx.create({methods:[method],secretKey:randomBytes(32).toString("hex")}).evm.charge({amount:"0.01"}), initial=await route(new Request("https://merchant.invalid/paid")),challenge=selected.Challenge.fromResponse(initial.challenge),account=accounts.privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),nonce=selectedEvm.challengeHash(challenge),validBefore=String(Math.floor(Date.now()/1000)+300);count.sign++;const signature=await account.signTypedData({domain:selectedEvm.authorizationDomain({authorization:{name:"USDC",version:"2"},chainId:84532,currency:challenge.request.currency}),message:{from:account.address,nonce,to:challenge.request.recipient,value:BigInt(challenge.request.amount),validAfter:0n,validBefore:BigInt(validBefore)},primaryType:"TransferWithAuthorization",types:selectedEvm.authorizationTypes}),encoded=selected.Credential.serialize({challenge,payload:{from:account.address,nonce,signature,to:challenge.request.recipient,type:"authorization",validAfter:"0",validBefore,value:challenge.request.amount}});let error;try{await method.verify({credential:selected.Credential.deserialize(encoded)});}catch(cause){error=cause;} const expected=configured??current.Errors.PaymentError,selectedInstance=error instanceof selected.Errors.PaymentError,currentInstance=error instanceof current.Errors.PaymentError;assert.ok(error instanceof expected); if(caseId==="wrong-owner-negative")assert.equal(selectedInstance,false);else assert.equal(caseId==="default-current-same-owner"?currentInstance:selectedInstance,true); return {path:"owner",caseId,condition,status:"PASSED",owner:profile.owner,inventory,counters:count,outcome:caseId==="wrong-owner-negative"?"owner-mismatch":"safe-pending",ownerEquality:caseId!=="wrong-owner-negative",selectedInstance,currentInstance,credentialSha256:hash(encoded)};
}

export async function runCurrentSettleUnknown({input,row,directory,assert,onReady,profile}) { if(input.stage!=="final-7b"||row!==profile.row||profile.catalog!==currentSettleUnknownCases[profile.protocol])throw new Error("SETTLE_UNKNOWN_PROFILE_REJECTED"); const subcases=[];for(const condition of ["import","require"])subcases.push(...await settleUnknownBuyerSequence({input,directory:join(directory,`buyer-${condition}`),condition,profile,assert,onReady}));for(const condition of ["import","require"])subcases.push(await settleUnknownSeller({input,directory:join(directory,`seller-${condition}`),condition,profile,assert,onReady}));for(const caseId of profile.catalog.owner)for(const condition of ["import","require"])subcases.push(await settleUnknownOwner({input,directory:join(directory,`owner-${caseId}-${condition}`),condition,caseId,profile,assert}));return subcases; }

async function realmSubcase({ input, directory, profile, condition, assert, onReady }) {
  await mkdir(directory, { mode: 0o700 });
  const startedAt = new Date().toISOString(), caseId = "coincident-realm-x402";
  const config = { condition, protocol: "mpp", payBuyer: true, native: input.native, pay: input.consumer.directory, certificates: input.certificates, realmCaseId: caseId, realmProfile: profile };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  const checkpoints = []; let buyer, last, failure, status = "FAILED";
  const totals = counters();
  try {
    const facilitator = await spawnRole("scripted-facilitator"), merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
    const snapshot = async () => {
      const values = {};
      for (const role of [merchant, facilitator]) { role.send({ type: "snapshot" }); values[role.role === "merchant" ? "merchant" : "facilitator"] = await role.take("snapshot"); }
      checkpoints.push(values); for (const value of Object.values(values)) assert.deepEqual(value.failures, []); return values;
    };
    const initial = await snapshot();
    assert.deepEqual(initial.merchant.realmArrivals, []); assert.deepEqual(initial.merchant.realmOffers, []); assert.deepEqual(initial.facilitator.realmPrivateArrivals, []);
    const store = join(directory, "durable"); initializeStore(store);
    const buyerRole = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store });
    buyer = { pid: buyerRole.child.pid, ...await buyerRole.take("realm-result") };
    assert.deepEqual(await buyerRole.close, { code: 0, signal: null, reason: null });
    last = await snapshot();
    for (const value of [buyer, last.merchant, last.facilitator]) for (const key of Object.keys(totals)) totals[key] += value.counters[key];
    assert.equal(buyer.counters.rpc, last.facilitator.counters.rpc); totals.rpc = last.facilitator.counters.rpc;
    const offer = last.merchant.realmOffers[0]; assert.equal(last.merchant.realmOffers.length, 1);
    assert.equal(offer.profile, profile); assert.equal(offer.realm, profile === "ordinary" ? "127.0.0.1" : profile);
    assert.equal(offer.headerSha256, buyer.offers[0].headerSha256); assert.equal(offer.urlSha256, buyer.offers[0].urlSha256); assert.equal(buyer.offers[0].x402Present, false);
    assert.deepEqual(buyer.preference, ["mpp"]); assert.equal(await persisted(store, "mpp"), null);
    // Preserve the first actual public verdict before testing the unchanged
    // compatibility expectation. A captured error can never make this pass.
    if (buyer.error !== null && profile !== "ordinary") status = "NEEDS_CONTEXT";
    await scenario.closeRoles([merchant, facilitator]);
    assert.equal(buyer.error, null, "GENUINE_MPP_REALM_COMPATIBILITY");
    assert.equal(buyer.status, 200); assert.equal(buyer.pending, false); assert.equal(buyer.receiptValid, true);
    assert.deepEqual([buyer.saveAttempts, buyer.clearAttempts], [1, 1]);
    assert.deepEqual([totals.sign, totals.save, totals.signedSend, totals.settle, totals.handler, totals.economicEffect, totals.applicationEffect, totals.clear, totals.rpc], [1, 1, 1, 1, 1, 1, 1, 1, 4]);
    assert.equal(totals.supported, 0); assert.equal(totals.verify, 0);
    assert.deepEqual(last.merchant.realmArrivals.map(value => value.protocol), [null, "mpp"]);
    assert.deepEqual(last.facilitator.realmPrivateArrivals.map(value => [value.path, value.method, value.wireProtocol]), [["/v1/settlements/charge", "POST", "mpp"]]);
    assert.deepEqual(last.merchant.received, [buyer.saved.credentialSha256]);
    status = "PASSED";
  } catch (error) { failure = hash(String(error?.message)); }
  finally {
    const diagnostics = await scenario.cleanup();
    if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes)) { status = "FAILED"; failure ??= hash("UNEXPECTED_ROLE_OUTPUT"); }
    await writeFile(join(directory, "realm.json"), JSON.stringify({ caseId, profile, condition, startedAt, completedAt: new Date().toISOString(), status, ...(failure ? { failure } : {}), roles: roles.map(role => role.identity), ports, tls: tlsControls, buyer, counters: totals, merchant: last?.merchant, facilitator: last?.facilitator, checkpoints, diagnostics, roleFailures: roles.flatMap(role => role.failures) }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  return JSON.parse(await readFile(join(directory, "realm.json")));
}

export async function runRealmSlice({ input, row, directory, assert, onReady, billingOnly = false }) {
  assert.ok(["mppx-0.8.19", "mppx-0.8.17"].includes(input.fixture)); assert.equal(row, input.fixture + "-protocol-freeze");
  const subcases = [];
  for (const profile of ["ordinary", billingOnly ? "billing" : "x402"]) {
    const pair = await Promise.allSettled(["import", "require"].map(condition => realmSubcase({ input, directory: join(directory, profile + "-" + condition), profile, condition, assert, onReady })));
    for (const result of pair) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
    if (subcases.some(value => value.status !== "PASSED")) throw new Error("REALM_COMPATIBILITY_FAILED");
  }
  return subcases;
}

async function dualSubcase({ input, directory, caseId, condition, assert, onReady }) {
  await mkdir(directory, { mode: 0o700 });
  const duplicateCase = caseId === "duplicate-incompatible-offers";
  const config = { condition, protocol: input.fixture.startsWith("mppx-") ? "mpp" : "x402", payBuyer: true, native: input.native, pay: input.consumer.directory, certificates: input.certificates, dualCaseId: caseId, dualStage: duplicateCase ? "negative" : "initial" };
  const selected = duplicateCase ? config.protocol : caseId.endsWith("-x402") ? "x402" : "mpp", opposite = selected === "x402" ? "mpp" : "x402";
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  const buyers = [], checkpoints = []; let observation, failure;
  try {
    const facilitator = await spawnRole("scripted-facilitator"), merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
    const snapshot = async () => {
      const values = {};
      for (const role of [merchant, facilitator]) { role.send({ type: "snapshot" }); values[role.role === "merchant" ? "merchant" : "facilitator"] = await role.take("snapshot"); }
      checkpoints.push(values); for (const value of Object.values(values)) assert.deepEqual(value.failures, []); return values;
    };
    await snapshot();
    const store = join(directory, "durable"); initializeStore(store);
    let buyerRole, buyer, last;
    for (const stage of duplicateCase ? ["negative", "positive"] : ["initial"]) {
      if (stage === "positive") { merchant.send({ type: "configure", step: "proof" }); assert.equal((await merchant.take("configured")).step, "proof"); }
      buyerRole = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store, dualStage: stage });
      buyer = await buyerRole.take("dual-result"); buyers.push({ pid: buyerRole.child.pid, ...buyer });
      assert.deepEqual(await buyerRole.close, { code: 0, signal: null, reason: null });
      last = await snapshot();
      if (stage === "negative") {
        assert.deepEqual(buyer.error, { code: "PAYMENT_CHALLENGE_INVALID", phase: "challenge", retryable: false });
        assert.deepEqual(Object.values(buyer.counters), Array(13).fill(0)); assert.equal(buyer.pending, false);
        assert.deepEqual([buyer.saveAttempts, buyer.clearAttempts, buyer.sent.length], [0, 0, 0]);
        assert.equal(last.merchant.dualArrivals.length, 1); assert.equal(await persisted(store, selected), null);
        for (const value of [last.merchant, last.facilitator]) for (const key of ["settle", "handler", "economicEffect", "applicationEffect", "rpc"]) assert.equal(value.counters[key], 0);
      }
    }
    const totals = counters(), protocolCounters = { x402: counters(), mpp: counters() };
    for (const value of [...buyers, last.merchant, last.facilitator]) for (const key of Object.keys(totals)) totals[key] += value.counters[key];
    assert.equal(buyer.counters.rpc, last.facilitator.counters.rpc); totals.rpc = last.facilitator.counters.rpc;
    for (const protocol of ["x402", "mpp"]) for (const value of [last.merchant, last.facilitator]) for (const key of Object.keys(totals)) protocolCounters[protocol][key] += value.protocolCounters[protocol][key];
    assert.deepEqual([totals.sign, totals.save, totals.signedSend, totals.settle, totals.handler, totals.economicEffect, totals.applicationEffect, totals.clear, totals.rpc], [1, 1, 1, 1, 1, 1, 1, 1, 4]);
    assert.equal(buyer.selectedProtocol, selected); assert.equal(buyer.receiptValid, true); assert.equal(buyer.pending, false);
    assert.deepEqual(["verify", "settle", "handler", "economicEffect", "applicationEffect"].map(key => protocolCounters[opposite][key]), [0, 0, 0, 0, 0]);
    assert.equal(await persisted(store, selected), null);
    assert.deepEqual(last.merchant.dualArrivals.map(value => value.protocol), duplicateCase ? [null, null, selected] : [null, selected]);
    assert.deepEqual(last.merchant.received, [buyer.saved.credentialSha256]);
    const owned = (role, root, name) => { const values = role.identity.inventory.filter(value => value.name === name && value.entry.startsWith(root + "/node_modules/")); assert.equal(values.length, 1); return values[0]; };
    const names = protocol => ({ generator: protocol === "mpp" ? "mppx/server" : "@x402/core/server", decoder: protocol === "mpp" ? "mppx" : "@x402/core/http" });
    const owner = (protocol, root) => Object.fromEntries(Object.entries(names(protocol)).map(([kind, name]) => [kind, owned(merchant, root, name)]));
    const owners = { selected: owner(config.protocol, config.native), ...duplicateCase ? {} : { auxiliary: owner(config.protocol === "x402" ? "mpp" : "x402", config.pay) }, buyer: owned(buyerRole, config.pay, "@0xkey-io/pay/client"), receiptDecoder: owned(buyerRole, selected === config.protocol ? config.native : config.pay, names(selected).decoder) };
    assert.deepEqual(owners.receiptDecoder, (selected === config.protocol ? owners.selected : owners.auxiliary).decoder);
    await scenario.closeRoles([merchant, facilitator]);
    observation = { caseId, condition, status: "PASSED", counters: totals, protocolCounters, merchant: last.merchant, facilitator: last.facilitator, owners };
  } catch (error) {
    failure = hash(String(error?.message));
    const values = {};
    for (const role of roles.filter(role => ["merchant", "scripted-facilitator"].includes(role.role) && role.origin)) {
      try { role.send({ type: "snapshot" }); values[role.role === "merchant" ? "merchant" : "facilitator"] = await role.take("snapshot"); } catch {}
    }
    if (Object.keys(values).length) checkpoints.push(values);
  }
  finally {
    const diagnostics = await scenario.cleanup();
    if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
    const result = { ...observation, ...(failure ? { caseId, condition, status: "FAILED", failure } : {}), roles: roles.map(role => role.identity), ports, tls: tlsControls, buyers, checkpoints, diagnostics, roleFailures: roles.flatMap(role => role.failures) };
    await writeFile(join(directory, "dual.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (failure) throw new Error("DUAL_SUBCASE_FAILED");
  }
  return JSON.parse(await readFile(join(directory, "dual.json")));
}

export async function runDualSlice({ input, row, directory, assert, onReady }) {
  assert.equal(row, input.fixture + "-malformed-ambiguous-offer"); const subcases = [];
  for (const caseId of dualCaseIds) {
    const pair = await Promise.allSettled(["import", "require"].map(condition => dualSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady })));
    for (const result of pair) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  return subcases;
}

async function preflightSubcase({ input, directory, caseId, condition, assert, onReady, networkMismatchFinal = false, mppNetworkMismatchFinal = false }) {
  await mkdir(directory, { mode: 0o700 });
  const networkCase = caseId === "pending-open-other-network";
  const config = { condition, protocol: input.fixture.startsWith("mppx-") ? "mpp" : "x402", payBuyer: true, native: input.native, pay: input.consumer.directory, certificates: input.certificates, preflightCaseId: caseId, preflightStage: networkCase ? "capture" : "negative", ...(networkMismatchFinal ? { networkMismatchFinal: true } : {}), ...(mppNetworkMismatchFinal ? { mppNetworkMismatchFinal: true } : {}) };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  const buyers = [], checkpoints = []; let observation, failure, persistedBeforeConflict = null, persistedAfterConflict = null;
  try {
    const facilitator = await spawnRole("scripted-facilitator"), merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
    const snapshot = async () => {
      const values = {};
      for (const role of [merchant, facilitator]) { role.send({ type: "snapshot" }); values[role.role === "merchant" ? "merchant" : "facilitator"] = await role.take("snapshot"); }
      for (const value of Object.values(values)) assert.deepEqual(value.failures, []);
      checkpoints.push(values); return values;
    };
    await snapshot();
    const store = join(directory, "durable"); initializeStore(store);
    const keySha256 = hash(await readFile(join(store, "storage.key")));
    for (const stage of networkCase ? ["capture", "incompatible", "resume"] : ["negative", "positive"]) {
      const buyer = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store, preflightStage: stage });
      if (stage === "capture") {
        const prepared = await buyer.take("preflight-prepared");
        assert.deepEqual([prepared.counters.sign, prepared.saveAttempts, prepared.counters.save, prepared.counters.signedSend, prepared.counters.rpc, prepared.counters.clear], [1, 1, 1, 0, 0, 0]);
        buyer.child.kill("SIGKILL"); const termination = await buyer.close;
        assert.deepEqual(termination, { code: null, signal: "SIGKILL", reason: "ROLE_EXIT_NONZERO" });
        buyers.push({ pid: buyer.child.pid, stage, ...prepared, termination }); await snapshot();
        persistedBeforeConflict = await persisted(store, config.protocol); assert.ok(persistedBeforeConflict);
        // Preserve the actual original ciphertext before successful recovery
        // clears the live slot; this is a byte copy, never a resealed record.
        await copyFile(join(store, "pending.aead"), join(directory, "captured-pending.aead"));
        assert.equal(hash(await readFile(join(directory, "captured-pending.aead"))), persistedBeforeConflict.ciphertextSha256);
        assert.equal(persistedBeforeConflict.keySha256, keySha256);
        assert.equal(persistedBeforeConflict.credentialSha256, prepared.credentialSha256);
        assert.equal(persistedBeforeConflict.recordSha256, prepared.recordSha256);
        continue;
      }
      const result = await buyer.take("preflight-result"); buyers.push({ pid: buyer.child.pid, ...result });
      assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
      await snapshot();
      assert.equal(hash(await readFile(join(store, "storage.key"))), keySha256);
      if (stage === "incompatible") {
        persistedAfterConflict = await persisted(store, config.protocol); assert.deepEqual(persistedAfterConflict, persistedBeforeConflict);
        assert.deepEqual(result.error, { code: "PENDING_PAYMENT_CONFLICT", phase: "recovery", retryable: false });
        assert.deepEqual(result.pendingError, result.error); assert.equal(result.pending, null);
        assert.deepEqual(Object.values(result.counters), Array(13).fill(0));
        assert.deepEqual([result.saveAttempts, result.clearAttempts, result.transports.length, result.requests.length], [0, 0, 0, 0]);
        assert.deepEqual(checkpoints[2], checkpoints[1]);
        continue;
      }
      assert.equal(await persisted(store, config.protocol), null);
      if (stage === "negative") {
        assert.deepEqual(result.error, { code: "PAYMENT_SERVICE_UNAVAILABLE", phase: "request", retryable: true });
        assert.deepEqual(Object.values(result.counters), Array(13).fill(0));
        assert.deepEqual([result.saveAttempts, result.clearAttempts, result.pending, result.pendingError, result.status], [0, 0, false, null, null]);
        assert.deepEqual(checkpoints[1], checkpoints[0]);
        assert.deepEqual(checkpoints[1].merchant.businessArrivals, []);
      } else {
        assert.equal(result.error, null); assert.equal(result.receiptValid, true); assert.equal(result.pending, false);
        assert.deepEqual([result.counters.sign, result.saveAttempts, result.counters.save, result.counters.signedSend, result.counters.rpc, result.counters.clear], [networkCase ? 0 : 1, networkCase ? 0 : 1, networkCase ? 0 : 1, 1, 4, 1]);
        const bodySha256 = networkCase ? hash("") : result.input.bodySha256, method = networkCase ? "GET" : "POST";
        assert.equal(result.requests.length, networkCase ? 1 : 2); assert.equal(result.requests.every(request => request.bodySha256 === bodySha256 && request.method === method), true);
        assert.deepEqual(checkpoints.at(-1).merchant.received, [result.credentialSha256]);
        const arrivals = checkpoints.at(-1).merchant.businessArrivals; assert.equal(arrivals.length, 2);
        assert.equal(arrivals.every(arrival => arrival.bodySha256 === bodySha256 && arrival.method === method && BigInt(arrival.atNs) <= BigInt(arrival.bodyReadAtNs)), true);
        if (networkCase) assert.equal(result.credentialSha256, persistedBeforeConflict.credentialSha256);
      }
    }
    const totals = counters(), last = checkpoints.at(-1);
    for (const value of [...buyers, last.merchant, last.facilitator]) for (const key of Object.keys(totals)) totals[key] += value.counters[key];
    assert.equal(buyers.reduce((sum, buyer) => sum + buyer.counters.rpc, 0), last.facilitator.counters.rpc); totals.rpc = last.facilitator.counters.rpc;
    assert.deepEqual([totals.sign, totals.save, totals.signedSend, totals.settle, totals.handler, totals.economicEffect, totals.applicationEffect, totals.clear, totals.rpc], [1, 1, 1, 1, 1, 1, 1, 1, 4]);
    assert.equal(new Set(buyers.map(buyer => buyer.pid)).size, networkCase ? 3 : 2);
    await scenario.closeRoles([merchant, facilitator]);
    observation = { caseId, condition, status: "PASSED", counters: totals, keySha256, persistedAfter: await persisted(store, config.protocol) };
  } catch (error) { failure = hash(String(error?.message)); }
  finally {
    const diagnostics = await scenario.cleanup();
    if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
    const result = { ...observation, ...(failure ? { caseId, condition, status: "FAILED", failure } : {}), ...(networkCase ? { persistedBeforeConflict, persistedAfterConflict } : {}), roles: roles.map(role => role.identity), ports, tls: tlsControls, buyers, checkpoints, diagnostics, roleFailures: roles.flatMap(role => role.failures) };
    await writeFile(join(directory, "preflight.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (failure) throw new Error("PREFLIGHT_SUBCASE_FAILED");
  }
  return JSON.parse(await readFile(join(directory, "preflight.json")));
}

export async function runPreflightSlice({ input, row, directory, assert, onReady }) {
  const catalog = preflightCases[row.slice(input.fixture.length + 1)]; assert.ok(catalog);
  const subcases = [];
  for (const caseId of catalog) {
    const pair = await Promise.allSettled(["import", "require"].map(condition => preflightSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady })));
    for (const result of pair) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  return subcases;
}

// These are only the approved claim subcases, not either complete fault family.
const claimCases = Object.freeze({
  replay: Object.freeze(["single-client-singleflight", "multi-client-atomic-claim"]),
  "protocol-freeze": Object.freeze(["save-if-absent-false", "save-if-absent-throws"]),
});

async function persisted(store, protocol) {
  const record = await durableStore(store, () => { throw new Error("READ_ONLY_STORE"); }, () => false).load();
  if (!record) return null;
  const header = protocol === "mpp" ? "authorization" : "payment-signature";
  return { credentialSha256: hash(record.payment.headers.find(([name]) => name === header)[1]), recordSha256: record.digest.slice(2), ciphertextSha256: hash(await readFile(join(store, "pending.aead"))), keySha256: hash(await readFile(join(store, "storage.key"))) };
}

async function claimSubcase({ input, directory, caseId, condition, assert, onReady, replayFinal = false }) {
  await mkdir(directory, { mode: 0o700 });
  const store = join(directory, "durable"); initializeStore(store);
  const config = { condition, protocol: input.fixture.startsWith("mppx-") ? "mpp" : "x402", payBuyer: true, native: input.native, pay: input.consumer.directory, certificates: input.certificates, ...(replayFinal ? { replayFinal: true, replayCaseId: caseId, caseId, store } : {}) };
  const scenario = nativeScenario({ config, assert });
  const { roles, ports, tlsControls, spawnRole } = scenario;
  const claimWindows = [], decisions = [], buyers = [];
  let observation, failure;
  try {
    const facilitator = await spawnRole("scripted-facilitator");
    const merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    onReady(Number(new URL(merchant.origin).port));
    await scenario.verifyTls([facilitator, merchant]);
    const race = caseId === "multi-client-atomic-claim", single = caseId === "single-client-singleflight";
    if (race) { merchant.send({ type: "configure", step: "missing" }); assert.equal((await merchant.take("configured")).step, "missing"); }
    const contenders = [];
    for (let index = 0; index < (race ? 2 : 1); index++) {
      const buyer = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store, caseId });
      contenders.push(buyer);
      const window = await buyer.take("claim-ready");
      assert.equal(window.caseId, caseId);
      assert.deepEqual([window.counters.sign, window.counters.save, window.counters.signedSend, window.saveAttempts], [1, 0, 0, 1]);
      claimWindows.push({ pid: buyer.child.pid, ...window, readyAtNs: process.hrtime.bigint().toString() });
    }
    const releasedAtNs = process.hrtime.bigint().toString();
    const barrierReleasedAfterAllReady = claimWindows.length === contenders.length && claimWindows.every(window => BigInt(window.readyAtNs) < BigInt(releasedAtNs));
    assert.equal(barrierReleasedAfterAllReady, true);
    // No await between releases: both real processes race their atomic store.
    for (const buyer of contenders) buyer.send({ type: "claim-release", caseId });
    for (const buyer of contenders) {
      const decision = await buyer.take("claim-decided"); assert.equal(decision.caseId, caseId);
      decisions.push({ pid: buyer.child.pid, ...decision });
    }
    const persistedBeforeSend = await persisted(store, config.protocol);
    assert.equal(decisions.filter(decision => decision.saveOutcome === "saved").length, race || single ? 1 : 0);
    // Preserve the winning slot while the loser completes its public error
    // path. The claim race is already finished; no store attempt is serialized.
    const completionOrder = [...contenders].sort((a, b) => Number(decisions.find(item => item.pid === a.child.pid).saveOutcome === "saved") - Number(decisions.find(item => item.pid === b.child.pid).saveOutcome === "saved"));
    for (const buyer of completionOrder) {
      buyer.send({ type: "claim-proceed", caseId });
      const result = await buyer.take("claim-result"); assert.equal(result.caseId, caseId);
      assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
      buyers.push({ pid: buyer.child.pid, ...result });
    }
    const persistedAfter = await persisted(store, config.protocol), snapshots = [];
    for (const role of [merchant, facilitator]) { role.send({ type: "snapshot" }); snapshots.push(await role.take("snapshot")); }
    for (const snapshot of snapshots) assert.deepEqual(snapshot.failures, []);
    const totals = counters();
    for (const result of [...buyers, ...snapshots]) for (const key of Object.keys(totals)) totals[key] += result.counters[key];
    assert.equal(buyers.reduce((sum, buyer) => sum + buyer.counters.rpc, 0), snapshots[1].counters.rpc);
    totals.rpc = snapshots[1].counters.rpc;
    const saveAttempts = buyers.reduce((sum, buyer) => sum + buyer.saveAttempts, 0), received = snapshots[0].received;
    assert.deepEqual([totals.sign, saveAttempts, totals.save, totals.signedSend, totals.settle, totals.handler, totals.economicEffect, totals.applicationEffect, totals.clear], [race ? 2 : 1, race ? 2 : 1, race || single ? 1 : 0, race || single ? 1 : 0, race || single ? 1 : 0, race || single ? 1 : 0, race || single ? 1 : 0, race || single ? 1 : 0, single ? 1 : 0]);
    if (race || single) {
      const winner = buyers.find(buyer => buyer.saveOutcome === "saved");
      assert.equal(persistedBeforeSend.credentialSha256, winner.candidateCredentialSha256);
      assert.equal(persistedBeforeSend.recordSha256, winner.candidateRecordSha256);
      assert.deepEqual(received, [winner.candidateCredentialSha256]);
      if (single) {
        assert.deepEqual(winner.calls, [{ status: 200, errorCode: null }, { status: null, errorCode: "PAYMENT_IN_PROGRESS" }]);
        assert.equal(persistedAfter, null); assert.equal(winner.pending, false);
      } else {
        const loser = buyers.find(buyer => buyer.saveOutcome !== "saved");
        assert.ok(loser.candidateCredentialSha256 !== winner.candidateCredentialSha256);
        assert.ok(loser.candidateRecordSha256 !== winner.candidateRecordSha256);
        assert.deepEqual(persistedAfter, persistedBeforeSend);
        assert.deepEqual(winner.calls, [{ status: null, errorCode: "PAYMENT_RECEIPT_MISSING" }]);
        assert.deepEqual(loser.calls, [{ status: null, errorCode: loser.saveOutcome === "occupied" ? "PENDING_PAYMENT_CLAIMED" : "PAYMENT_SERVICE_UNAVAILABLE" }]);
        assert.equal(loser.storageError, loser.saveOutcome === "occupied" ? null : "EEXIST");
        assert.equal(loser.counters.signedSend, 0); assert.equal(buyers.every(buyer => buyer.pending), true);
      }
    } else {
      const throwing = caseId === "save-if-absent-throws", buyer = buyers[0];
      assert.equal(buyer.saveOutcome, throwing ? "threw" : "occupied");
      assert.equal(buyer.storageError, throwing ? "CONTROLLED_THROW" : null);
      assert.deepEqual(buyer.calls, [{ status: null, errorCode: throwing ? "PAYMENT_SERVICE_UNAVAILABLE" : "PENDING_PAYMENT_CLAIMED" }]);
      assert.equal(buyer.pending, true); assert.equal(persistedBeforeSend, null); assert.equal(persistedAfter, null); assert.deepEqual(received, []);
    }
    await scenario.closeRoles([merchant, facilitator]);
    observation = { caseId, condition, status: "PASSED", storeKind: race || single ? "atomic-aead" : "callback-control", roles: roles.map(role => role.identity), ports, tls: tlsControls, counters: totals, saveAttempts, claimWindows, decisions, releasedAtNs, barrierReleasedAfterAllReady, buyers, received, persistedBeforeSend, persistedAfter, roleObservations: { merchant: snapshots[0], facilitator: snapshots[1] } };
  } catch (error) { failure = hash(String(error?.message)); }
  finally {
    const diagnostics = await scenario.cleanup();
    if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
    const result = failure ? { caseId, condition, status: "FAILED", failure, claimWindows, decisions, buyers, ports, diagnostics, roleFailures: roles.flatMap(role => role.failures) } : { ...observation, diagnostics };
    await writeFile(join(directory, "claim.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (failure) throw new Error("CLAIM_SUBCASE_FAILED");
  }
  return JSON.parse(await readFile(join(directory, "claim.json")));
}

export async function runClaimSlice({ input, row, directory, assert, onReady }) {
  const family = row.slice(input.fixture.length + 1), catalog = claimCases[family];
  assert.ok(catalog);
  const subcases = [];
  for (const caseId of catalog) for (const condition of ["import", "require"]) {
    subcases.push(await claimSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady }));
  }
  return subcases;
}

async function deriveFrozenRecord({ originalStore, directory, caseId, assert }) {
  const original = await durableStore(originalStore, () => {}, () => false).load();
  const record = structuredClone(original), payment = record.payment;
  let fields;
  if (caseId === "old-v2-pending") { payment.version = 2; fields = ["version"]; }
  else if (caseId === "old-v3-binding") {
    fields = ["protocolId", "adapterRevision", "economicEffectDigest"];
    for (const field of fields) delete payment[field];
  } else if (caseId === "changed-body-on-resume") {
    assert.equal(payment.method, "POST");
    assert.equal(Buffer.from(payment.bodyBase64, "base64").toString(), "freeze-original-body");
    payment.bodyBase64 = Buffer.from("freeze-mutated-body").toString("base64"); fields = ["bodyBase64"];
  } else {
    assert.equal(caseId, "changed-request-binding");
    assert.ok(payment.economicEffectDigest !== "0x" + "00".repeat(32));
    payment.economicEffectDigest = "0x" + "00".repeat(32); fields = ["economicEffectDigest", "requestDigest"];
    const { requestDigest, ...unsigned } = payment;
    payment.requestDigest = "0x" + hash(JSON.stringify(unsigned)); record.digest = payment.requestDigest;
  }
  // These are explicit test-derived records, not ciphertext corruption or
  // fixtures attributed to a historical released SDK. Keep the source store.
  initializeStore(directory); let derivedSaves = 0;
  const derived = durableStore(directory, () => { derivedSaves++; }, () => false);
  assert.equal(await derived.saveIfAbsent(record), true);
  const authenticated = await derived.load(); assert.deepEqual(authenticated, record);
  const { requestDigest, ...unsigned } = authenticated.payment;
  const checksumValid = requestDigest === "0x" + hash(JSON.stringify(unsigned));
  assert.equal(checksumValid, caseId === "changed-request-binding");
  return { derivation: "test-derived-from-real-saved-record", boundary: caseId.startsWith("old-") ? "version" : caseId === "changed-body-on-resume" ? "unkeyed-checksum" : "protocol-economic-binding", fields: fields.map(field => ({ field, beforeSha256: hash(JSON.stringify(original.payment[field]) ?? "absent"), afterSha256: hash(JSON.stringify(payment[field]) ?? "absent") })), checksumRecomputed: caseId === "changed-request-binding", checksumValid, aeadAuthenticated: true, derivedSaves };
}

async function freezeSubcase({ input, directory, caseId, condition, assert, onReady, protocolFreezeFinal = false }) {
  await mkdir(directory, { mode: 0o700 });
  const shape = ["other-protocol-shaped-nonce", "other-protocol-error-text", "coincident-fields"].includes(caseId);
  const config = { condition, protocol: input.fixture.startsWith("mppx-") ? "mpp" : "x402", payBuyer: true, native: input.native, pay: input.consumer.directory, certificates: input.certificates, freezeCaseId: caseId, freezeStage: "initial", ...(shape && protocolFreezeFinal ? { protocolFreezeFinal: true } : {}) };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  const buyers = []; let observation, failure, original, mutation = null, persistedBeforeResume = null;
  try {
    const facilitator = await spawnRole("scripted-facilitator");
    const merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    onReady(Number(new URL(merchant.origin).port));
    await scenario.verifyTls([facilitator, merchant]);
    const invalid = ["old-v2-pending", "old-v3-binding", "changed-body-on-resume", "changed-request-binding"].includes(caseId), before = caseId === "redirect-before-payment";
    const store = join(directory, "durable"); initializeStore(store);
    const first = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store, freezeStage: invalid ? "capture" : "initial" });
    if (invalid) {
      const prepared = await first.take("prepared");
      assert.deepEqual([prepared.counters.sign, prepared.counters.save, prepared.counters.signedSend, prepared.counters.clear], [1, 1, 0, 0]);
      first.child.kill("SIGKILL"); const termination = await first.close;
      assert.deepEqual(termination, { code: null, signal: "SIGKILL", reason: "ROLE_EXIT_NONZERO" });
      buyers.push({ pid: first.child.pid, stage: "capture", ...prepared, termination });
    } else {
      buyers.push({ pid: first.child.pid, stage: "initial", ...await first.take("freeze-result") });
      assert.deepEqual(await first.close, { code: 0, signal: null, reason: null });
    }
    original = await persisted(store, config.protocol);
    const sourceRecord = await durableStore(store, () => {}, () => false).load();
    const originalRequest = sourceRecord ? { protocolId: sourceRecord.payment.protocolId, network: sourceRecord.payment.network, method: sourceRecord.payment.method, bodySha256: hash(sourceRecord.payment.bodyBase64 ? Buffer.from(sourceRecord.payment.bodyBase64, "base64") : Buffer.alloc(0)) } : null;
    let resumeStore = store;
    if (invalid) {
      resumeStore = join(directory, "derived-durable");
      mutation = await deriveFrozenRecord({ originalStore: store, directory: resumeStore, caseId, assert });
    }
    if (!before) {
      persistedBeforeResume = await persisted(resumeStore, config.protocol);
      const resumed = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store: resumeStore, freezeStage: "resume" });
      const result = await resumed.take("freeze-result");
      buyers.push({ pid: resumed.child.pid, stage: "resume", ...result });
      assert.deepEqual(await resumed.close, { code: 0, signal: null, reason: null });
      assert.deepEqual([result.counters.sign, result.counters.save, result.counters.clear], [0, 0, 0]);
    }
    const persistedAfter = await persisted(resumeStore, config.protocol);
    assert.deepEqual(await persisted(store, config.protocol), original);
    const snapshots = [];
    for (const role of [merchant, facilitator]) { role.send({ type: "snapshot" }); snapshots.push(await role.take("snapshot")); }
    for (const snapshot of snapshots) assert.deepEqual(snapshot.failures, []);
    const totals = counters();
    for (const result of [...buyers, ...snapshots]) for (const key of Object.keys(totals)) totals[key] += result.counters[key];
    assert.deepEqual([totals.sign, totals.save, totals.signedSend, totals.clear, totals.settle, totals.handler, totals.economicEffect], [before ? 0 : 1, before ? 0 : 1, invalid || before ? 0 : 2, 0, 0, 0, 0]);
    assert.equal(snapshots[0].redirectTargets, 0);
    assert.deepEqual(snapshots[1].supportedProtocols, config.protocol === "x402" ? ["x402"] : []);
    for (const request of buyers.flatMap(buyer => buyer.requests ?? [])) {
      assert.equal(request.redirect, "manual");
      if (request.signed) { assert.equal(request.network, originalRequest.network); assert.equal(request.protocol, config.protocol); assert.equal(request.credentialSha256, original.credentialSha256); }
    }
    if (invalid) {
      const last = buyers.at(-1), expected = caseId.startsWith("old-") ? "PENDING_PAYMENT_VERSION_UNSUPPORTED" : "PENDING_PAYMENT_CORRUPT";
      assert.equal(last.errorCode, expected); assert.equal(last.pendingError, expected);
      assert.deepEqual(persistedAfter, persistedBeforeResume); assert.deepEqual(snapshots[0].received, []);
    } else if (before) {
      assert.equal(buyers[0].errorCode, "PAYMENT_POLICY_DENIED"); assert.equal(buyers[0].pending, false); assert.equal(persistedAfter, null);
    } else {
      assert.deepEqual(persistedAfter, original); assert.equal(buyers.every(buyer => buyer.pending), true);
      assert.deepEqual(snapshots[0].received, [original.credentialSha256, original.credentialSha256]);
      if (caseId === "redirect-after-payment") assert.equal(buyers.every(buyer => buyer.errorCode === "PAYMENT_POLICY_DENIED"), true);
      else if (caseId === "other-protocol-error-text") assert.equal(buyers.every(buyer => buyer.errorCode === "PAYMENT_STATUS_UNKNOWN"), true);
      else { assert.equal(buyers[1].status, 402); assert.equal(buyers[1].errorCode, null); }
    }
    await scenario.closeRoles([merchant, facilitator]);
    observation = { caseId, condition, status: "PASSED", roles: roles.map(role => role.identity), ports, tls: tlsControls, counters: totals, buyers, original, originalRequest, mutation, persistedBeforeResume, persistedAfter, merchant: snapshots[0], facilitator: snapshots[1] };
  } catch (error) { failure = hash(String(error?.message)); }
  finally {
    const diagnostics = await scenario.cleanup();
    if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
    const result = failure ? { caseId, condition, status: "FAILED", failure, buyers, original, mutation, ports, diagnostics, roleFailures: roles.flatMap(role => role.failures) } : { ...observation, diagnostics };
    await writeFile(join(directory, "freeze.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (failure) throw new Error("FREEZE_SUBCASE_FAILED");
  }
  return JSON.parse(await readFile(join(directory, "freeze.json")));
}

export async function runFreezeSlice({ input, directory, assert, onReady }) {
  const subcases = [];
  for (const caseId of freezeCaseIds) for (const condition of ["import", "require"]) subcases.push(await freezeSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady }));
  return subcases;
}

async function freezeCrashSubcase({input,directory,condition,profile,assert,onReady}) {
  await mkdir(directory,{mode:0o700});const config={condition,protocol:profile.protocol,payBuyer:true,native:input.native,pay:input.consumer.directory,certificates:input.certificates},scenario=nativeScenario({config,assert}),{roles,ports,tlsControls,spawnRole}=scenario;let failure,firstResult,resumedResult,merchantSnapshot,facilitatorSnapshot;
  try{const facilitator=await spawnRole("scripted-facilitator"),merchant=await spawnRole("merchant",{facilitator:facilitator.origin});onReady(Number(new URL(merchant.origin).port));await scenario.verifyTls([facilitator,merchant]);const store=join(directory,"durable");initializeStore(store);for(const role of [facilitator,merchant]){role.send({type:"configure",step:"save-before-send-exit"});assert.equal((await role.take("configured")).step,"save-before-send-exit");}const first=await spawnRole("buyer",{facilitator:facilitator.origin,merchant:merchant.origin,store,step:"save-before-send-exit"});firstResult=await first.take("prepared");first.child.kill("SIGKILL");assert.equal((await first.close).signal,"SIGKILL");for(const role of [facilitator,merchant]){role.send({type:"configure",step:"proof"});assert.equal((await role.take("configured")).step,"proof");}const resumed=await spawnRole("buyer",{facilitator:facilitator.origin,merchant:merchant.origin,store,step:"proof"});resumedResult=await resumed.take("completed");assert.deepEqual(await resumed.close,{code:0,signal:null,reason:null});assert.equal(resumedResult.credentialSha256,firstResult.credentialSha256);assert.deepEqual([firstResult.counters.sign,firstResult.counters.save,firstResult.counters.signedSend],[1,1,0]);assert.deepEqual([resumedResult.counters.sign,resumedResult.counters.save,resumedResult.counters.clear],[0,0,1]);merchant.send({type:"snapshot"});merchantSnapshot=await merchant.take("snapshot");facilitator.send({type:"snapshot"});facilitatorSnapshot=await facilitator.take("snapshot");await scenario.closeRoles([merchant,facilitator]);}catch(error){failure=hash(String(error?.message));}const diagnostics=await scenario.cleanup();if(diagnostics.some(r=>r.stdout.bytes||r.stderr.bytes))failure??=hash("UNEXPECTED_ROLE_OUTPUT");if(failure)throw new Error("PROTOCOL_FREEZE_CRASH_FAILED");const total=counters();for(const value of [firstResult,resumedResult,merchantSnapshot,facilitatorSnapshot])for(const key of Object.keys(total))total[key]+=value.counters[key];total.rpc=facilitatorSnapshot.counters.rpc;return{path:"restart",caseId:"durable-save-before-first-send-exit",condition,status:"PASSED",inventory:roles.flatMap(r=>r.identity.inventory),counters:total,outcome:"resumed-same-authenticated-record",credentialSha256:firstResult.credentialSha256,ports,tls:tlsControls,diagnostics};
}

async function freezeCallbackSubcase({input,directory,condition,profile,assert}) {
  await mkdir(directory,{mode:0o700});const inventory=[];await publicModule(input.native,profile.protocol==="mpp"?"mppx":"@x402/core/http",condition,inventory);const output=join(directory,"signer-probe.json"),environment=await isolatedEnvironment(join(directory,"environment"),{path:"/opt/homebrew/bin:/usr/bin:/bin",corepackHome:input.corepack}),script=fileURLToPath(new URL("../../../../packages/pay/scripts/signer-error-probe.mjs",import.meta.url));
  const run=await runProcess({command:[process.execPath,script,input.consumer.directory,condition,output],cwd:directory,env:environment,expectedVersions:{node:process.versions.node,pay:"1.0.0-rc.1",x402:"2.23.0",mppx:"0.8.19"},timeoutMs:30000});assert.equal(run.status,"PASSED");const raw=JSON.parse(await readFile(output));assert.equal(raw.failed,0);const owned=raw.rows.find(item=>item.label===`${profile.protocol}-signer-forged`),stale=raw.rows.find(item=>item.label==="same-client-no-stale-provenance"),resume=raw.rows.find(item=>item.label==="sign-after-failure-unknown");assert.equal(owned?.passed,true);assert.equal(stale?.passed,true);assert.equal(resume?.passed,true);const count=counters();count.sign=owned.observation.counts.signAttempt;return{path:"callback",caseId:"callback-signing-provenance",condition,status:"PASSED",inventory:[...inventory,...raw.inventory],counters:count,outcome:"owned-signer-provenance",controls:{forgedCallerVerdictRejected:true,staleProvenanceRejected:true,resumeCredentialStable:resume.observation.identicalResumeCredential},probe:{status:run.status,cleanup:run.cleanup,outputSha256:hash(await readFile(output)),scriptSha256:hash(await readFile(script))}};
}

export async function runCurrentProtocolFreeze({input,row,directory,assert,onReady,profile}) {
  if(input.stage!=="final-7b"||row!==profile.row||profile.catalog!==currentProtocolFreezeCases)throw new Error("PROTOCOL_FREEZE_PROFILE_REJECTED");const subcases=[];
  const withInventory=value=>({...value,inventory:value.inventory??value.roles.flatMap(role=>role.inventory)});
  for(const caseId of profile.catalog.wire)for(const condition of ["import","require"])subcases.push({...withInventory(await freezeSubcase({input,directory:join(directory,`wire-${caseId}-${condition}`),caseId,condition,assert,onReady,protocolFreezeFinal:true})),path:"wire"});
  for(const caseId of profile.catalog.restart.filter(id=>id!=="durable-save-before-first-send-exit"))for(const condition of ["import","require"])subcases.push({...withInventory(await freezeSubcase({input,directory:join(directory,`restart-${caseId}-${condition}`),caseId,condition,assert,onReady,protocolFreezeFinal:true})),path:"restart"});
  for(const condition of ["import","require"])subcases.push(await freezeCrashSubcase({input,directory:join(directory,`restart-durable-save-before-first-send-exit-${condition}`),condition,profile,assert,onReady}));
  const claimDirectory=join(directory,"claim-controls");await mkdir(claimDirectory,{mode:0o700});const claims=await runClaimSlice({input,row,directory:claimDirectory,assert,onReady});for(const value of claims)subcases.push({...withInventory(value),path:"claim"});
  for(const condition of ["import","require"])subcases.push(await freezeCallbackSubcase({input,directory:join(directory,`callback-${condition}`),condition,profile,assert}));return subcases;
}

async function redactionProtocolSubcase({input,directory,condition,profile,assert,onReady}){
  await mkdir(directory,{mode:0o700});const flow=await freezeCrashSubcase({input,directory:join(directory,"native-flow"),condition,profile,assert,onReady});
  const sentinels=["credential-sentinel-7b","stamp-sentinel-7b","secret-key-sentinel-7b","receipt-sentinel-7b","body-sentinel-7b"],raw=sentinels.map((value,index)=>JSON.stringify({type:"observation",counters:{sign:0},["private"+index]:value})).join("\n"),redacted=redactOutput(raw);
  assert.deepEqual(redacted.events,[]);assert.equal(redacted.discardedLines,sentinels.length);assert.equal(sentinels.some(value=>JSON.stringify(redacted).includes(value)),false);
  const result={path:"protocol",caseId:currentRedactionCases.protocol[0],condition,status:"PASSED",inventory:flow.inventory,counters:flow.counters,outcome:"native-flow-and-fail-closed-redaction",control:{rawInputs:sentinels.length,discardedLines:redacted.discardedLines,bytes:redacted.bytes,sha256:redacted.sha256,credentialDigest:flow.credentialSha256}};
  await writeFile(join(directory,"redaction-protocol.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});return result;
}

async function redactionCallbackSubcase({input,directory,condition,profile,caseId,assert}){
  await mkdir(directory,{mode:0o700});const inventory=[];await publicModule(input.native,profile.protocol==="mpp"?"mppx":"@x402/core/http",condition,inventory);const environment=await isolatedEnvironment(join(directory,"environment"),{path:"/opt/homebrew/bin:/usr/bin:/bin",corepackHome:input.corepack});
  const signer=caseId==="r102-signer-provenance",script=fileURLToPath(new URL(signer?"../../../../packages/pay/scripts/signer-error-probe.mjs":"../../../../packages/pay/scripts/client-error-probe.mjs",import.meta.url)),output=join(directory,"probe.json"),foreign=join(directory,"foreign-consumer");
  if(!signer)await cp(input.consumer.directory,foreign,{recursive:true,errorOnExist:true});let run,raw,outputSha256;
  try{run=await runProcess({command:[process.execPath,script,input.consumer.directory,condition,output,...(signer?[]:[foreign])],cwd:directory,env:environment,expectedVersions:signer?{node:process.versions.node,pay:"1.0.0-rc.1",x402:"2.23.0",mppx:"0.8.19"}:{node:process.versions.node,pay:"1.0.0-rc.1",x402:"2.23.0"},timeoutMs:30000});assert.equal(run.status,"PASSED");const bytes=await readFile(output);outputSha256=hash(bytes);raw=JSON.parse(bytes);assert.equal(raw.failed,0);
    if(signer){for(const label of [`${profile.protocol}-signer-forged`,"same-client-no-stale-provenance","sign-after-failure-unknown"])assert.equal(raw.rows.find(row=>row.label===label)?.passed,true);}
    else for(const label of ["fetch-lifecycle-callback","resume-lifecycle-callback","fetch-forged-object","fetch-forged-error"])assert.equal(raw.rows.find(row=>row.label===label)?.passed,true);
  }finally{try{await deleteRawOutput(output);}finally{if(!signer)await rm(foreign,{recursive:true,force:true});}}
  const count=counters();count.sign=signer?raw.rows.find(row=>row.label===`${profile.protocol}-signer-forged`).observation.counts.signAttempt:0;const result={path:"callback",caseId,condition,status:"PASSED",inventory:[...inventory,...raw.inventory],counters:count,outcome:"fresh-bound-callback-provenance",control:{rows:raw.rows.length,failed:raw.failed,rawOutputDeleted:true,outputSha256,scriptSha256:hash(await readFile(script)),cleanup:run.cleanup}};
  await writeFile(join(directory,"redaction-callback.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});return result;
}

async function redactionSupervisorSubcase({input,directory,condition,profile,caseId,assert}){
  await mkdir(directory,{mode:0o700});const inventory=[];await publicModule(input.native,profile.protocol==="mpp"?"mppx":"@x402/core/http",condition,inventory);const environment=await isolatedEnvironment(join(directory,"environment"),{path:"/opt/homebrew/bin:/usr/bin:/bin",corepackHome:input.corepack}),script=fileURLToPath(new URL("../../test/child.mjs",import.meta.url)),scenario={"bad-ipc":"raw-output","coercible-control":"coercible-observation","stderr-secret":"stderr","output-limit":"success"}[caseId];
  const run=await runProcess({command:[process.execPath,script,scenario],cwd:directory,env:environment,expectedVersions:{node:process.versions.node},timeoutMs:3000,maxOutputBytes:caseId==="output-limit"?20:4096}),expected={"bad-ipc":["UNKNOWN","CONTROL_CORRUPT"],"coercible-control":["UNKNOWN","CONTROL_CORRUPT"],"stderr-secret":["FAILED","STDERR_PRESENT"],"output-limit":["UNKNOWN","OUTPUT_LIMIT"]}[caseId];assert.deepEqual([run.status,run.reason],expected);assert.equal(run.cleanup.groupAbsent,true);assert.equal(/unique-private-sentinel-7a|synthetic-discriminator-secret-7a/.test(JSON.stringify(run)),false);
  const result={path:"supervisor",caseId,condition,status:"PASSED",inventory,counters:counters(),outcome:"rejected-and-cleaned",control:{observedStatus:run.status,reason:run.reason,cleanup:run.cleanup,stdout:run.stdout,stderr:run.stderr,scriptSha256:hash(await readFile(script))}};await writeFile(join(directory,"redaction-supervisor.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});return result;
}

export async function runCurrentRedaction({input,row,directory,assert,onReady,profile}){
  if(input.stage!=="final-7b"||row!==profile.row||profile.catalog!==currentRedactionCases)throw new Error("REDACTION_PROFILE_REJECTED");const subcases=[];
  for(const caseId of profile.catalog.protocol)for(const condition of ["import","require"])subcases.push(await redactionProtocolSubcase({input,directory:join(directory,`protocol-${caseId}-${condition}`),condition,profile,assert,onReady}));
  for(const caseId of profile.catalog.callback)for(const condition of ["import","require"])subcases.push(await redactionCallbackSubcase({input,directory:join(directory,`callback-${caseId}-${condition}`),condition,profile,caseId,assert}));
  for(const caseId of profile.catalog.supervisor)for(const condition of ["import","require"])subcases.push(await redactionSupervisorSubcase({input,directory:join(directory,`supervisor-${caseId}-${condition}`),condition,profile,caseId,assert}));return subcases;
}

async function receiptSubcase({ input, directory, caseId, condition, assert, onReady, receiptAbsentMalformedFinal = false, unverifiedReceiptFinal = false, receiptMismatchFinal = false }) {
  await mkdir(directory, { mode: 0o700 });
  const config = { condition, protocol: input.fixture.startsWith("mppx-") ? "mpp" : "x402", payBuyer: true, native: input.native, pay: input.consumer.directory, certificates: input.certificates, receiptCaseId: caseId, receiptStage: "negative", ...(receiptAbsentMalformedFinal ? { receiptAbsentMalformedFinal: true } : {}), ...(unverifiedReceiptFinal ? { unverifiedReceiptFinal: true } : {}), ...(receiptMismatchFinal ? { receiptMismatchFinal: true } : {}) };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  const buyers = []; let observation, failure, persistedAtFailure, merchantSnapshot, facilitatorSnapshot;
  try {
    const facilitator = await spawnRole("scripted-facilitator");
    const merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
    const store = join(directory, "durable"); initializeStore(store);
    for (const stage of ["negative", "proof"]) {
      if (stage === "proof") for (const role of [merchant, facilitator]) { role.send({ type: "configure", step: "proof" }); assert.equal((await role.take("configured")).step, "proof"); }
      const buyer = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store, receiptStage: stage });
      const result = await buyer.take("receipt-result"); buyers.push({ pid: buyer.child.pid, stage, ...result });
      assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
      if (stage === "negative") {
        persistedAtFailure = await persisted(store, config.protocol);
        assert.ok(persistedAtFailure); assert.equal(result.pending, true); assert.ok(result.error);
        assert.deepEqual([result.counters.sign, result.counters.save, result.counters.signedSend, result.counters.clear, result.clearAttempts], [1, 1, 1, 0, 0]);
        assert.equal(persistedAtFailure.ciphertextSha256, result.sentCiphertextSha256);
        await copyFile(join(store, "pending.aead"), join(directory, "pending-at-failure.aead"));
        const malformed = receiptCases["receipt-absent-malformed"].includes(caseId) && caseId !== "absent";
        const unverified = ["rpc-unavailable", "rpc-invalid-response", "audited-verifier-throws"].includes(caseId);
        assert.deepEqual(result.error, { code: malformed ? "PAYMENT_SERVICE_UNAVAILABLE" : caseId === "absent" ? "PAYMENT_RECEIPT_MISSING" : unverified ? "PAYMENT_RECEIPT_UNVERIFIED" : "PAYMENT_RECEIPT_MISMATCH", phase: malformed ? "request" : "receipt", retryable: malformed || unverified });
      } else {
        assert.deepEqual([result.counters.sign, result.counters.save, result.counters.signedSend, result.counters.clear, result.clearAttempts, result.counters.rpc], [0, 0, 1, 1, 1, 4]);
        assert.equal(result.error, null); assert.equal(result.pending, false); assert.equal(result.status, 200); assert.equal(result.receiptValid, true);
        assert.equal(result.sentCiphertextSha256, persistedAtFailure.ciphertextSha256);
        assert.equal(result.credentialSha256, persistedAtFailure.credentialSha256); assert.equal(result.recordSha256, persistedAtFailure.recordSha256);
      }
    }
    const persistedAfter = await persisted(store, config.protocol); assert.equal(persistedAfter, null);
    assert.equal(hash(await readFile(join(store, "storage.key"))), persistedAtFailure.keySha256);
    merchant.send({ type: "snapshot" }); merchantSnapshot = await merchant.take("snapshot");
    facilitator.send({ type: "snapshot" }); facilitatorSnapshot = await facilitator.take("snapshot");
    for (const snapshot of [merchantSnapshot, facilitatorSnapshot]) assert.deepEqual(snapshot.failures, []);
    const totals = counters();
    for (const result of [...buyers, merchantSnapshot, facilitatorSnapshot]) for (const key of Object.keys(totals)) totals[key] += result.counters[key];
    assert.equal(buyers.reduce((sum, buyer) => sum + buyer.counters.rpc, 0), facilitatorSnapshot.counters.rpc); totals.rpc = facilitatorSnapshot.counters.rpc;
    assert.deepEqual([totals.sign, totals.save, totals.signedSend, totals.clear, totals.settle, totals.handler, totals.economicEffect, totals.applicationEffect, totals.verify, totals.fulfillment, totals.challenge], [1, 1, 2, 1, 2, 2, 1, 1, 0, 0, 1]);
    assert.deepEqual(merchantSnapshot.received, [persistedAtFailure.credentialSha256, persistedAtFailure.credentialSha256]);
    const firstEvents = buyers[0].events.map(event => event.event);
    assert.ok(firstEvents.indexOf("sign") < firstEvents.indexOf("save") && firstEvents.indexOf("save") < firstEvents.indexOf("signedSend"));
    const clearAt = BigInt(buyers[1].events.find(event => event.event === "clear").atNs);
    assert.equal(facilitatorSnapshot.events.filter(event => event.event === "rpc").slice(-4).every(event => BigInt(event.atNs) < clearAt), true);
    await scenario.closeRoles([merchant, facilitator]);
    observation = { caseId, condition, status: "PASSED", roles: roles.map(role => role.identity), ports, tls: tlsControls, counters: totals, buyers, persistedAtFailure, persistedAfter, merchant: merchantSnapshot, facilitator: facilitatorSnapshot };
  } catch (error) { failure = hash(String(error?.message)); }
  finally {
    const diagnostics = await scenario.cleanup();
    if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
    const result = failure ? { caseId, condition, status: "FAILED", failure, buyers, persistedAtFailure, merchant: merchantSnapshot, facilitator: facilitatorSnapshot, ports, diagnostics, roleFailures: roles.flatMap(role => role.failures) } : { ...observation, diagnostics };
    await writeFile(join(directory, "receipt.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (failure) throw new Error("RECEIPT_SUBCASE_FAILED");
  }
  return JSON.parse(await readFile(join(directory, "receipt.json")));
}

export async function runReceiptSlice({ input, row, directory, assert, onReady }) {
  const catalog = receiptCases[row.slice(input.fixture.length + 1)]; assert.ok(catalog);
  const subcases = [];
  for (const caseId of catalog) {
    if (input.fixture.startsWith("mppx-") && caseId === "wrong-receipt-network") continue;
    // Exactly two isolated cases at a time; settle both cleanups on failure.
    const results = await Promise.allSettled(["import", "require"].map(condition => receiptSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  return subcases;
}

export async function runCurrentReceiptAbsentMalformed({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); const subcases = [];
  for (const caseId of profile.catalog) {
    const results = await Promise.allSettled(["import", "require"].map(condition => receiptSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady, receiptAbsentMalformedFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  const expected = profile.catalog.flatMap(caseId => ["import", "require"].map(condition => [caseId, condition]));
  assert.deepEqual(subcases.map(value => [value.caseId, value.condition]), expected); assert.equal(subcases.length, 10); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

export async function runCurrentUnverifiedReceipt({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); const subcases = [];
  for (const caseId of profile.catalog) {
    const results = await Promise.allSettled(["import", "require"].map(condition => receiptSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady, unverifiedReceiptFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  const expected = profile.catalog.flatMap(caseId => ["import", "require"].map(condition => [caseId, condition]));
  assert.deepEqual(subcases.map(value => [value.caseId, value.condition]), expected); assert.equal(subcases.length, 8); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

export async function runCurrentReceiptMismatch({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); const subcases = [];
  for (const caseId of profile.catalog) {
    const results = await Promise.allSettled(["import", "require"].map(condition => receiptSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady, receiptMismatchFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  const expected = profile.catalog.flatMap(caseId => ["import", "require"].map(condition => [caseId, condition]));
  assert.deepEqual(subcases.map(value => [value.caseId, value.condition]), expected); assert.equal(subcases.length, profile.protocol === "x402" ? 30 : 28); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

async function offerSubcase({ input, directory, caseId, condition, assert, onReady, authorizationOffer = false, mppAuthorizationOffer = false, networkMismatchFinal = false, mppNetworkMismatchFinal = false, amountMismatchFinal = false, mppAmountMismatchFinal = false, assetMismatchFinal = false, mppAssetMismatchFinal = false, payeeMismatchFinal = false, mppPayeeMismatchFinal = false, temporalValidityFinal = false, profile }) {
  await mkdir(directory, { mode: 0o700 });
  const config = { condition, protocol: input.fixture.startsWith("mppx-") ? "mpp" : "x402", payBuyer: true, native: input.native, pay: input.consumer.directory, certificates: input.certificates, offerCaseId: caseId, offerStage: "negative", ...(authorizationOffer ? { authorizationOffer: true } : {}), ...(mppAuthorizationOffer ? { mppAuthorizationOffer: true } : {}), ...(networkMismatchFinal ? { networkMismatchFinal: true } : {}), ...(mppNetworkMismatchFinal ? { mppNetworkMismatchFinal: true } : {}), ...(amountMismatchFinal ? { amountMismatchFinal: true } : {}), ...(mppAmountMismatchFinal ? { mppAmountMismatchFinal: true } : {}), ...(assetMismatchFinal ? { assetMismatchFinal: true } : {}), ...(mppAssetMismatchFinal ? { mppAssetMismatchFinal: true } : {}), ...(payeeMismatchFinal ? { payeeMismatchFinal: true } : {}), ...(mppPayeeMismatchFinal ? { mppPayeeMismatchFinal: true } : {}), ...(temporalValidityFinal ? { temporalValidityFinal: true } : {}) };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  const buyers = [], checkpoints = []; let observation, failure, persistedAfterNegative, merchantSnapshot, facilitatorSnapshot;
  try {
    const facilitator = await spawnRole("scripted-facilitator"), merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
    const store = join(directory, "durable"); initializeStore(store);
    const keySha256 = hash(await readFile(join(store, "storage.key")));
    for (const stage of ["negative", "positive"]) {
      assert.equal(await persisted(store, config.protocol), null);
      // Only the merchant's mutation is disabled. Each buyer starts a fresh
      // unpaid fetch with the same profile; neither stage calls resume().
      if (stage === "positive") { merchant.send({ type: "configure", step: "proof" }); assert.equal((await merchant.take("configured")).step, "proof"); }
      const buyer = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store, offerStage: stage });
      const result = await buyer.take("offer-result"); buyers.push({ pid: buyer.child.pid, stage, ...result });
      assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
      if (authorizationOffer) {
        assert.equal(result.authorizationOffer, true); assert.equal(result.stage, stage); assert.equal(Object.hasOwn(result, "selector"), false);
        if (stage === "negative") {
          const targetValue = caseId === "upto" ? "upto" : caseId === "permit2" ? "permit2" : "future-transfer";
          assert.deepEqual(result.targetSelector, { field: caseId === "upto" ? "accepts.scheme" : "accepts.extra.assetTransferMethod", valueSha256: hash(targetValue), owner: profile.owner });
          assert.equal(result.actualSelector, null);
        } else {
          assert.equal(result.targetSelector, null);
          assert.deepEqual(result.actualSelector, { scheme: "exact", assetTransferMethod: "eip3009", owner: profile.owner });
        }
      }
      merchant.send({ type: "snapshot" }); merchantSnapshot = await merchant.take("snapshot");
      facilitator.send({ type: "snapshot" }); facilitatorSnapshot = await facilitator.take("snapshot");
      checkpoints.push({ stage, merchant: merchantSnapshot, facilitator: facilitatorSnapshot });
      for (const snapshot of [merchantSnapshot, facilitatorSnapshot]) assert.deepEqual(snapshot.failures, []);
      if (mppAuthorizationOffer) assert.equal(merchantSnapshot.redirectTargets, 0);
      if (mppAuthorizationOffer) {
        assert.equal(result.mppAuthorizationOffer, true); assert.equal(result.stage, stage);
        if (stage === "negative") {
          assert.equal(result.actualSelection, null); assert.deepEqual(result.targetSelection, { protocol: "mpp", method: caseId === "non-evm-method" ? "tempo" : "evm", intent: caseId === "session-intent" ? "session" : "charge", authorization: null, owner: profile.owner, operation: "challenge-decode", wireSha256: result.targetSelection.wireSha256 }); assert.equal(/^[a-f0-9]{64}$/.test(result.targetSelection.wireSha256), true);
        } else {
          assert.equal(result.targetSelection, null); assert.deepEqual(result.actualSelection, { protocol: "mpp", method: "evm", intent: "charge", authorization: "authorization", owner: profile.owner, operation: "credential-decode", wireSha256: result.actualSelection.wireSha256 }); assert.equal(/^[a-f0-9]{64}$/.test(result.actualSelection.wireSha256), true);
        }
      }
      if (stage === "negative") {
        persistedAfterNegative = await persisted(store, config.protocol); assert.equal(persistedAfterNegative, null); assert.equal(result.pending, false);
        assert.deepEqual([result.counters.sign, result.counters.save, result.saveAttempts, result.counters.signedSend, result.counters.clear, result.clearAttempts, result.counters.rpc], [0, 0, 0, 0, 0, 0, 0]);
        const policy = ["other-base-network-offer", "unsupported-chain-offer", "non-usdc-offer", "wrong-network-usdc", "wrong-decimals", "above-ceiling"].includes(caseId);
        const expired = caseId === "expired-challenge", unsupported = ["permit2", "unknown-required-extension", "session-intent", "non-evm-method"].includes(caseId);
        assert.deepEqual(result.error, { code: expired ? "PAYMENT_SERVICE_UNAVAILABLE" : policy ? "PAYMENT_POLICY_DENIED" : unsupported ? "PAYMENT_OFFER_UNSUPPORTED" : "PAYMENT_CHALLENGE_INVALID", phase: expired ? "request" : policy ? "policy" : "challenge", retryable: expired });
        assert.deepEqual([merchantSnapshot.counters.challenge, merchantSnapshot.counters.handler, merchantSnapshot.counters.applicationEffect, facilitatorSnapshot.counters.settle, facilitatorSnapshot.counters.economicEffect, facilitatorSnapshot.counters.rpc], [1, 0, 0, 0, 0, 0]);
        assert.deepEqual(merchantSnapshot.received, []);
      } else {
        assert.deepEqual([result.counters.sign, result.counters.save, result.saveAttempts, result.counters.signedSend, result.counters.clear, result.clearAttempts, result.counters.rpc], [1, 1, 1, 1, 1, 1, 4]);
        assert.equal(result.error, null); assert.equal(result.pending, false); assert.equal(result.status, 200); assert.equal(result.receiptValid, true);
      }
    }
    const persistedAfter = await persisted(store, config.protocol); assert.equal(persistedAfter, null);
    assert.equal(hash(await readFile(join(store, "storage.key"))), keySha256);
    const totals = counters();
    for (const result of [...buyers, merchantSnapshot, facilitatorSnapshot]) for (const key of Object.keys(totals)) totals[key] += result.counters[key];
    assert.equal(buyers.reduce((sum, buyer) => sum + buyer.counters.rpc, 0), facilitatorSnapshot.counters.rpc); totals.rpc = facilitatorSnapshot.counters.rpc;
    assert.deepEqual([totals.sign, totals.save, totals.signedSend, totals.clear, totals.settle, totals.handler, totals.economicEffect, totals.applicationEffect, totals.verify, totals.fulfillment, totals.challenge, totals.rpc], [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 2, 4]);
    assert.deepEqual(merchantSnapshot.received, [buyers[1].credentialSha256]);
    const events = buyers[1].events.map(event => event.event);
    assert.ok(events.indexOf("sign") < events.indexOf("save") && events.indexOf("save") < events.indexOf("signedSend"));
    const clearAt = BigInt(buyers[1].events.find(event => event.event === "clear").atNs);
    assert.equal(facilitatorSnapshot.events.filter(event => event.event === "rpc").every(event => BigInt(event.atNs) < clearAt), true);
    await scenario.closeRoles([merchant, facilitator]);
    const mppSelections = mppAuthorizationOffer ? { targetSelection: buyers[0].targetSelection, actualSelection: buyers[1].actualSelection } : {};
    observation = { caseId, condition, status: "PASSED", roles: roles.map(role => role.identity), ports, tls: tlsControls, counters: totals, buyers, checkpoints, keySha256, persistedAfterNegative, persistedAfter, merchant: merchantSnapshot, facilitator: facilitatorSnapshot, ...mppSelections };
  } catch (error) { failure = hash(String(error?.message)); }
  finally {
    const diagnostics = await scenario.cleanup();
    if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
    const result = failure ? { caseId, condition, status: "FAILED", failure, roles: roles.map(role => role.identity), buyers, checkpoints, persistedAfterNegative, merchant: merchantSnapshot, facilitator: facilitatorSnapshot, ports, tls: tlsControls, diagnostics, roleFailures: roles.flatMap(role => role.failures) } : { ...observation, diagnostics };
    await writeFile(join(directory, "offer.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (failure) throw new Error("OFFER_SUBCASE_FAILED");
  }
  return JSON.parse(await readFile(join(directory, "offer.json")));
}

async function authorizationCredentialSubcase({ input, directory, caseId, condition, assert, onReady, profile }) {
  await mkdir(directory, { mode: 0o700 });
  const checkpoints = [], roles = [], ports = [], tls = []; let failure;
  const totals = counters();
  try {
    for (const stage of ["negative", "positive"]) {
      const config = { condition, protocol: "x402", payBuyer: false, native: input.native, pay: input.consumer.directory, certificates: input.certificates, authorizationCaseId: caseId, authorizationStage: stage };
      const scenario = nativeScenario({ config, assert });
      const stageRoles = scenario.roles, stagePorts = scenario.ports, stageTls = scenario.tlsControls;
      let completed, diagnostics;
      try {
        const facilitator = await scenario.spawnRole("scripted-facilitator"), merchant = await scenario.spawnRole("merchant", { facilitator: facilitator.origin });
        onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
        const buyer = await scenario.spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin });
        const result = await buyer.take("authorization-result"); assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
        merchant.send({ type: "snapshot" }); const merchantSnapshot = await merchant.take("snapshot");
        facilitator.send({ type: "snapshot" }); const facilitatorSnapshot = await facilitator.take("snapshot");
        for (const snapshot of [merchantSnapshot, facilitatorSnapshot]) assert.deepEqual(snapshot.failures, []);
        assert.equal(result.caseId, caseId); assert.equal(result.stage, stage); assert.equal(result.wrapperCalls, 1);
        const targetValue = caseId === "upto" ? "upto" : caseId === "permit2" ? "permit2" : "future-transfer";
        const expectedActual = stage === "positive" ? { scheme: "exact", assetTransferMethod: "eip3009", owner: profile.owner } : { scheme: caseId === "upto" ? "upto" : "exact", assetTransferMethod: caseId === "permit2" ? "permit2" : caseId === "unknown-required-extension" ? "future-transfer" : "eip3009", owner: profile.owner };
        assert.deepEqual(result.actualSelector, expectedActual); assert.equal(Object.hasOwn(result, "selector"), false);
        if (stage === "negative") {
          assert.deepEqual(result.targetSelector, { field: caseId === "upto" ? "accepts.scheme" : "accepts.extra.assetTransferMethod", valueSha256: hash(targetValue), owner: profile.owner });
          assert.deepEqual([result.status, result.classification, result.counters.sign, result.counters.signedSend, result.receiptSha256, result.receiptValid], [402, "no-matching-requirements", 0, 1, null, false]);
          assert.deepEqual([merchantSnapshot.counters.challenge, merchantSnapshot.counters.handler, merchantSnapshot.counters.applicationEffect, facilitatorSnapshot.counters.verify, facilitatorSnapshot.counters.settle, facilitatorSnapshot.counters.economicEffect], [1, 0, 0, 0, 0, 0]);
          assert.deepEqual(merchantSnapshot.received.length, 1); assert.equal(merchantSnapshot.wireArrivals.length, 2);
        } else {
          assert.equal(result.targetSelector, null);
          assert.deepEqual([result.status, result.classification, result.counters.sign, result.counters.signedSend, result.receiptValid], [200, "paid", 1, 1, true]);
          assert.deepEqual([merchantSnapshot.counters.challenge, merchantSnapshot.counters.handler, merchantSnapshot.counters.applicationEffect, facilitatorSnapshot.counters.verify, facilitatorSnapshot.counters.settle, facilitatorSnapshot.counters.economicEffect], [1, 1, 1, 1, 1, 1]);
          assert.deepEqual(merchantSnapshot.received.length, 1); assert.equal(merchantSnapshot.wireArrivals.length, 2);
        }
        for (const value of [result, merchantSnapshot, facilitatorSnapshot]) for (const key of Object.keys(totals)) totals[key] += value.counters[key];
        await scenario.closeRoles([merchant, facilitator]); completed = { stage, buyer: result, merchant: merchantSnapshot, facilitator: facilitatorSnapshot };
      } finally {
        diagnostics = await scenario.cleanup(); roles.push(...stageRoles.map(role => role.identity)); ports.push(...stagePorts); tls.push(...stageTls);
        if (completed) { assert.equal(diagnostics.some(role => role.stdout.bytes || role.stderr.bytes), false); checkpoints.push({ ...completed, diagnostics }); }
      }
    }
  } catch (error) { failure = hash(String(error?.message)); }
  const result = { caseId, condition, path: "credential", status: failure ? "FAILED" : "PASSED", ...(failure ? { failure } : {}), roles, ports, tls, counters: totals, checkpoints };
  await writeFile(join(directory, "credential.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  if (failure) throw new Error("AUTHORIZATION_CREDENTIAL_SUBCASE_FAILED");
  return result;
}

export async function runCurrentX402UnsupportedAuthorization({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b");
  const subcases = [];
  for (const path of Object.keys(profile.catalog)) for (const caseId of profile.catalog[path]) {
    const run = path === "offer" ? offerSubcase : authorizationCredentialSubcase;
    const results = await Promise.allSettled(["import", "require"].map(condition => run({ input, directory: join(directory, path + "-" + caseId + "-" + condition), caseId, condition, assert, onReady, authorizationOffer: path === "offer", profile })));
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      subcases.push(path === "offer" ? { ...result.value, path } : result.value);
    }
  }
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(subcases.map(value => [value.path, value.caseId, value.condition]), expected);
  assert.equal(subcases.every(value => value.status === "PASSED"), true);
  return subcases;
}

async function mppAuthorizationCredentialSubcase({ input, directory, caseId, condition, assert, onReady, profile }) {
  await mkdir(directory, { mode: 0o700 });
  const checkpoints = [], roles = [], ports = [], tls = []; const totals = counters(); let failure;
  try {
    for (const stage of ["negative", "positive"]) {
      const config = { condition, protocol: "mpp", payBuyer: false, native: input.native, pay: input.consumer.directory, certificates: input.certificates, mppAuthorizationCaseId: caseId, mppAuthorizationStage: stage };
      const scenario = nativeScenario({ config, assert }); let completed;
      try {
        const facilitator = await scenario.spawnRole("scripted-facilitator"), merchant = await scenario.spawnRole("merchant", { facilitator: facilitator.origin });
        onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
        const buyer = await scenario.spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin });
        const result = await buyer.take("mpp-authorization-result"); assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
        merchant.send({ type: "snapshot" }); const merchantSnapshot = await merchant.take("snapshot"); facilitator.send({ type: "snapshot" }); const facilitatorSnapshot = await facilitator.take("snapshot");
        for (const snapshot of [merchantSnapshot, facilitatorSnapshot]) assert.deepEqual(snapshot.failures, []);
        assert.deepEqual([result.caseId, result.stage, result.wrapperCalls], [caseId, stage, 1]); assert.equal(merchantSnapshot.redirectTargets, 0);
        if (stage === "negative") {
          assert.deepEqual(result.targetSelection, { protocol: "mpp", method: "evm", intent: "charge", authorization: "future-authorization", owner: profile.owner, operation: "credential-decode", wireSha256: result.targetSelection.wireSha256 }); assert.equal(/^[a-f0-9]{64}$/.test(result.targetSelection.wireSha256), true); assert.equal(result.actualSelection, null);
          assert.deepEqual([result.status, result.classification, result.counters.sign, result.counters.signedSend, result.receiptSha256, result.receiptValid], [402, "invalid-payload", 1, 1, null, false]);
          assert.deepEqual([merchantSnapshot.counters.handler, merchantSnapshot.counters.applicationEffect, facilitatorSnapshot.counters.settle, facilitatorSnapshot.counters.economicEffect], [0, 0, 0, 0]);
        } else {
          assert.equal(result.targetSelection, null); assert.deepEqual(result.actualSelection, { protocol: "mpp", method: "evm", intent: "charge", authorization: "authorization", owner: profile.owner, operation: "credential-decode", wireSha256: result.actualSelection.wireSha256 }); assert.equal(/^[a-f0-9]{64}$/.test(result.actualSelection.wireSha256), true);
          assert.deepEqual([result.status, result.classification, result.counters.sign, result.counters.signedSend, result.receiptValid], [200, "paid", 1, 1, true]);
          assert.deepEqual([merchantSnapshot.counters.handler, merchantSnapshot.counters.applicationEffect, facilitatorSnapshot.counters.settle, facilitatorSnapshot.counters.economicEffect], [1, 1, 1, 1]);
        }
        for (const value of [result, merchantSnapshot, facilitatorSnapshot]) for (const key of Object.keys(totals)) totals[key] += value.counters[key];
        await scenario.closeRoles([merchant, facilitator]); completed = { stage, buyer: result, merchant: merchantSnapshot, facilitator: facilitatorSnapshot };
      } finally {
        const diagnostics = await scenario.cleanup(); roles.push(...scenario.roles.map(role => role.identity)); ports.push(...scenario.ports); tls.push(...scenario.tlsControls);
        if (completed) { assert.equal(diagnostics.some(role => role.stdout.bytes || role.stderr.bytes), false); checkpoints.push({ ...completed, diagnostics }); }
      }
    }
  } catch (error) { failure = hash(String(error?.message)); }
  const selections = failure ? {} : { targetSelection: checkpoints[0].buyer.targetSelection, actualSelection: checkpoints[1].buyer.actualSelection };
  const result = { caseId, condition, path: "wire", status: failure ? "FAILED" : "PASSED", ...(failure ? { failure } : {}), roles, ports, tls, counters: totals, checkpoints, ...selections };
  await writeFile(join(directory, "mpp-authorization.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  if (failure) throw new Error("MPP_AUTHORIZATION_CREDENTIAL_SUBCASE_FAILED"); return result;
}

export async function runCurrentMppUnsupportedAuthorization({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); const subcases = [];
  for (const path of Object.keys(profile.catalog)) for (const caseId of profile.catalog[path]) {
    const run = path === "offer" ? offerSubcase : mppAuthorizationCredentialSubcase;
    const results = await Promise.allSettled(["import", "require"].map(condition => run({ input, directory: join(directory, path + "-" + caseId + "-" + condition), caseId, condition, assert, onReady, mppAuthorizationOffer: path === "offer", profile })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push(path === "offer" ? { ...result.value, path } : result.value); }
  }
  const expected = Object.entries(currentMppUnsupportedAuthorizationCases).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

async function supportedSubcase({ input, directory, caseId, condition, assert, onReady, supportedFailureFinal = false }) {
  await mkdir(directory, { mode: 0o700 });
  const nondependency = caseId === "S-mpp-only-nondependency-positive", protocol = input.fixture.startsWith("mppx-") ? "mpp" : "x402";
  const config = { condition, protocol, payBuyer: false, native: input.native, pay: input.consumer.directory, certificates: input.certificates, supportCaseId: caseId, supportStage: nondependency ? "positive" : "negative", ...(supportedFailureFinal ? { supportedFailureFinal: true } : {}) };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  const checkpoints = []; let observation, failure;
  try {
    const facilitator = await spawnRole("scripted-facilitator"), merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
    for (const stage of nondependency ? ["positive"] : ["negative", "positive"]) {
      if (stage === "positive" && !nondependency) { facilitator.send({ type: "configure", step: "proof" }); assert.equal((await facilitator.take("configured")).step, "proof"); }
      const buyer = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, supportStage: stage });
      const bought = await buyer.take("support-buyer-result"); assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
      merchant.send({ type: "snapshot" }); const merchantSnapshot = await merchant.take("snapshot");
      facilitator.send({ type: "snapshot" }); const facilitatorSnapshot = await facilitator.take("snapshot");
      const stderr = Buffer.concat(merchant.streams.stderr), warning = { count: merchant.expectedSupportedWarning, bytes: stderr.length, sha256: hash(stderr) };
      checkpoints.push({ buyer: { pid: buyer.child.pid, ...bought }, merchant: merchantSnapshot, facilitator: facilitatorSnapshot, warning });
      assert.deepEqual(warning, nondependency ? { count: 0, bytes: 0, sha256: hash("") } : { count: 1, bytes: 120, sha256: "a5646607702706fcadf29c9b0ec20dfe087f34d0d0203e7c862fa9a007693ed3" });
      for (const snapshot of [merchantSnapshot, facilitatorSnapshot]) assert.deepEqual(snapshot.failures, []);
      const positive = stage === "positive", value = positive ? 1 : 0;
      assert.equal(bought.status, positive ? 200 : 502); assert.equal(bought.receiptValid, positive);
      assert.deepEqual(bought.error, positive ? null : { code: "PAYMENT_SERVICE_UNAVAILABLE", retryable: true });
      assert.equal(bought.retryAfter, positive ? null : "2"); assert.equal(bought.receiptSha256 === null, !positive);
      assert.deepEqual([bought.counters.sign, bought.counters.signedSend, bought.counters.save, bought.counters.clear, bought.counters.rpc, bought.wrapperCalls], [value, value, 0, 0, 0, 1]);
      assert.deepEqual([merchantSnapshot.counters.handler, merchantSnapshot.counters.applicationEffect, facilitatorSnapshot.counters.settle, facilitatorSnapshot.counters.economicEffect, facilitatorSnapshot.counters.fulfillment, facilitatorSnapshot.counters.verify], [value, value, value, value, value, protocol === "mpp" ? 0 : value]);
      assert.equal(facilitatorSnapshot.counters.supported, nondependency ? 0 : positive ? 2 : 1);
      assert.deepEqual(bought.signedProtocols, positive ? [protocol] : []);
      assert.deepEqual(bought.challenges.map(o => o.protocol).sort(), !positive ? [] : nondependency ? ["mpp"] : protocol === "mpp" ? ["mpp", "x402"] : ["x402"]);
      if (protocol === "mpp" && positive) assert.equal(bought.selectedChallengeSha256, bought.challenges.find(o => o.protocol === "mpp").challengeIdSha256);
      if (!positive) assert.deepEqual(merchantSnapshot.received, []);
    }
    const final = checkpoints.at(-1), arrivals = final.facilitator.supportArrivals, transports = final.merchant.supportTransports;
    assert.equal(arrivals.length, nondependency ? 0 : 2); assert.equal(transports.length, arrivals.length);
    for (const [i, arrival] of arrivals.entries()) {
      const delivery = transports[i], timeout = i === 0 && caseId === "S-supported-timeout";
      assert.equal(arrival.wireProtocol, "x402"); assert.equal(arrival.responseStatus, timeout ? null : 200);
      assert.equal(delivery.responseStatus, arrival.responseStatus); assert.equal(delivery.transportError, timeout ? "ABORT_ERR" : null);
      assert.ok(BigInt(delivery.startedAtNs) < BigInt(arrival.atNs) && BigInt(arrival.atNs) < BigInt(delivery.completedAtNs));
      if (timeout) { const elapsed = Number(BigInt(delivery.completedAtNs) - BigInt(delivery.startedAtNs)) / 1e6; assert.ok(elapsed >= 4500 && elapsed < 8000); }
    }
    const totals = counters();
    for (const result of [...checkpoints.map(c => c.buyer), final.merchant, final.facilitator]) for (const key of Object.keys(totals)) totals[key] += result.counters[key];
    assert.deepEqual([totals.sign, totals.signedSend, totals.settle, totals.handler, totals.economicEffect, totals.applicationEffect, totals.fulfillment, totals.save, totals.clear, totals.rpc, totals.challenge], [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, nondependency ? 1 : 2]);
    await scenario.closeRoles([merchant, facilitator]);
    observation = { caseId, condition, direction: "S", status: "PASSED", roles: roles.map(role => role.identity), ports, tls: tlsControls, counters: totals, checkpoints };
  } catch (error) { failure = hash(String(error?.message)); }
  finally {
    const diagnostics = await scenario.cleanup();
    if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes && role.expectedSupportedWarning !== 1)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
    const result = failure ? { caseId, condition, direction: "S", status: "FAILED", failure, roles: roles.map(role => role.identity), checkpoints, ports, tls: tlsControls, diagnostics, roleFailures: roles.flatMap(role => role.failures) } : { ...observation, diagnostics };
    await writeFile(join(directory, "supported.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (failure) throw new Error("SUPPORTED_SUBCASE_FAILED");
  }
  return JSON.parse(await readFile(join(directory, "supported.json")));
}

async function supportedCallerSubcase({ input, directory, caseId, condition, assert, onReady, supportedFailureFinal = false }) {
  await mkdir(directory, { mode: 0o700 });
  const config = { condition, protocol: "x402", payBuyer: false, native: input.native, pay: input.consumer.directory, certificates: input.certificates, supportCaseId: caseId, supportStage: "negative", ...(supportedFailureFinal ? { supportedFailureFinal: true } : {}) };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  const checkpoints = []; let observation, failure;
  try {
    const facilitator = await spawnRole("scripted-facilitator"); onReady(Number(new URL(facilitator.origin).port)); await scenario.verifyTls([facilitator]);
    const caller = await spawnRole("supported-caller", { facilitator: facilitator.origin });
    for (const stage of ["negative", "positive"]) {
      if (stage === "positive") { facilitator.send({ type: "configure", step: "proof" }); assert.equal((await facilitator.take("configured")).step, "proof"); }
      caller.send({ type: "support-call", caseId, stage }); const result = await caller.take("support-caller-result");
      facilitator.send({ type: "snapshot" }); const snapshot = await facilitator.take("snapshot");
      checkpoints.push({ caller: { pid: caller.child.pid, ...result }, facilitator: snapshot });
      assert.deepEqual(snapshot.failures, []); assert.equal(result.caseId, caseId); assert.equal(result.stage, stage);
      assert.deepEqual(result.counters, counters()); assert.equal(snapshot.counters.supported, stage === "negative" ? 1 : 2);
      for (const key of Object.keys(snapshot.counters)) if (key !== "supported") assert.equal(snapshot.counters[key], 0);
      const i = stage === "negative" ? 0 : 1, arrival = snapshot.supportArrivals[i], delivery = result.supportTransports[i], timeout = i === 0 && caseId === "X-supported-timeout";
      assert.equal(snapshot.supportArrivals.length, i + 1); assert.equal(result.supportTransports.length, i + 1);
      assert.equal(arrival.wireProtocol, "x402"); assert.equal(delivery.responseStatus, timeout ? null : 200); assert.equal(arrival.responseStatus, delivery.responseStatus);
      assert.equal(delivery.transportError, timeout ? "ABORT_ERR" : null);
      assert.ok(BigInt(delivery.startedAtNs) < BigInt(arrival.atNs) && BigInt(arrival.atNs) < BigInt(delivery.completedAtNs));
      if (timeout) { const ms = Number(BigInt(delivery.completedAtNs) - BigInt(delivery.startedAtNs)) / 1e6; assert.ok(ms >= 4500 && ms < 8000); }
    }
    assert.deepEqual(await caller.close, { code: 0, signal: null, reason: null }); await scenario.closeRoles([facilitator]);
    observation = { caseId, condition, direction: "X", status: "PASSED", roles: roles.map(role => role.identity), ports, tls: tlsControls, counters: checkpoints.at(-1).facilitator.counters, checkpoints };
  } catch (error) { failure = hash(String(error?.message)); }
  finally {
    const diagnostics = await scenario.cleanup();
    if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
    const result = failure ? { caseId, condition, direction: "X", status: "FAILED", failure, roles: roles.map(role => role.identity), checkpoints, ports, tls: tlsControls, diagnostics, roleFailures: roles.flatMap(role => role.failures) } : { ...observation, diagnostics };
    await writeFile(join(directory, "supported.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (failure) throw new Error("SUPPORTED_CALLER_SUBCASE_FAILED");
  }
  return JSON.parse(await readFile(join(directory, "supported.json")));
}

export async function runSupportedSlice({ input, directory, assert, onReady }) {
  const subcases = [];
  const mpp = input.fixture.startsWith("mppx-");
  for (const caseId of supportCaseIds.filter(id => id.startsWith("X-") ? !mpp : id !== "S-mpp-only-nondependency-positive" || mpp)) {
    const run = caseId.startsWith("X-") ? supportedCallerSubcase : supportedSubcase;
    const results = await Promise.allSettled(["import", "require"].map(condition => run({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  return subcases;
}

export async function runCurrentSupportedFailure({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); const subcases = [];
  for (const [direction, caseIds] of Object.entries(profile.catalog)) for (const caseId of caseIds) {
    const run = direction === "direct" ? supportedCallerSubcase : supportedSubcase;
    const results = await Promise.allSettled(["import", "require"].map(condition => run({ input, directory: join(directory, direction + "-" + caseId + "-" + condition), caseId, condition, assert, onReady, supportedFailureFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push({ ...result.value, path: direction }); }
  }
  const expected = Object.entries(profile.catalog).flatMap(([direction, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [direction, caseId, condition])));
  assert.deepEqual(subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

export async function runOfferSlice({ input, row, directory, assert, onReady }) {
  const catalog = offerCases[row.slice(input.fixture.length + 1)]; assert.ok(catalog);
  const subcases = [];
  for (const caseId of catalog.filter(id => !Object.hasOwn(offerCaseProtocols, id) || offerCaseProtocols[id] === (input.fixture.startsWith("mppx-") ? "mpp" : "x402"))) {
    const results = await Promise.allSettled(["import", "require"].map(condition => offerSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  return subcases;
}

export async function runCurrentMalformedAmbiguousOffer({ input, row, directory, assert, onReady, profile, runDecoder }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); assert.equal(row, profile.row);
  const runners = { offer: runOfferSlice, preflight: runPreflightSlice, dual: runDualSlice, wire: runWireSlice };
  const subcases = [];
  for (const [path, caseIds] of Object.entries(profile.catalog)) {
    const pathDirectory = join(directory, path); await mkdir(pathDirectory, { mode: 0o700 });
    if (path === "decoder") {
      for (const caseId of caseIds) for (const condition of ["import", "require"]) {
        const values = await runDecoder({ input, row, directory: pathDirectory, assert, onReady, selection: `${caseId}/${condition}` });
        subcases.push(...values.map(value => ({ ...value, path })));
      }
    } else {
      const values = await runners[path]({ input, row, directory: pathDirectory, assert, onReady });
      subcases.push(...values.map(value => ({ ...value, path })));
    }
  }
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(subcases.map(value => [value.path, value.caseId, value.condition]), expected);
  assert.equal(subcases.every(value => value.status === "PASSED"), true);
  return subcases;
}

async function sellerSubcase({ input, directory, caseId, condition, assert, onReady, handlerFailureFinal = false, fulfillmentFailureFinal = false, standardReceiptCaseId = null, replayCaseId = null }) {
  await mkdir(directory, { mode: 0o700 });
  const config = { condition, protocol: input.fixture.startsWith("mppx-") ? "mpp" : "x402", payBuyer: false, native: input.native, pay: input.consumer.directory, certificates: input.certificates, sellerCaseId: caseId, ...(handlerFailureFinal ? { handlerFailureFinal: true } : {}), ...(fulfillmentFailureFinal ? { fulfillmentFailureFinal: true } : {}), ...(standardReceiptCaseId ? { standardWireReceiptFinal: true, standardReceiptCaseId } : {}), ...(replayCaseId ? { replayFinal: true, replayCaseId } : {}) };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  const checkpoints = []; let observation, failure;
  try {
    const facilitator = await spawnRole("scripted-facilitator"), merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
    const buyer = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin });
    for (const stage of caseId === "handler-200" ? ["first"] : ["first", "retry"]) {
      if (stage === "retry") {
        for (const role of [merchant, facilitator]) { role.send({ type: "configure", step: "proof" }); assert.equal((await role.take("configured")).step, "proof"); }
        buyer.send({ type: "seller-retry", caseId });
      }
      const result = await buyer.take("seller-result");
      merchant.send({ type: "snapshot" }); const merchantSnapshot = await merchant.take("snapshot");
      facilitator.send({ type: "snapshot" }); const facilitatorSnapshot = await facilitator.take("snapshot");
      checkpoints.push({ buyer: { pid: buyer.child.pid, ...result }, merchant: merchantSnapshot, facilitator: facilitatorSnapshot });
      assert.equal(result.stage, stage); assert.equal(result.caseId, caseId); assert.equal(result.wrapperCalls, 1);
      for (const snapshot of [merchantSnapshot, facilitatorSnapshot]) assert.deepEqual(snapshot.failures, []);
      const n = checkpoints.length;
      assert.deepEqual([result.counters.sign, result.counters.signedSend, result.counters.save, result.counters.clear, result.counters.rpc], [1, n, 0, 0, 0]);
      assert.deepEqual([merchantSnapshot.counters.handler, merchantSnapshot.counters.applicationEffect, merchantSnapshot.counters.challenge, merchantSnapshot.redirectTargets], [n, 1, 1, 0]);
      assert.deepEqual([facilitatorSnapshot.counters.settle, facilitatorSnapshot.counters.economicEffect, facilitatorSnapshot.counters.fulfillment, facilitatorSnapshot.counters.verify], [n, 1, n, config.protocol === "x402" ? n : 0]);
      const fault = stage === "first" && caseId.startsWith("fulfillment-");
      const status = stage === "retry" ? 200 : fault ? 503 : { "handler-throws": 500, "handler-500": 500, "handler-400": 400, "handler-404": 404, "handler-302": 302, "handler-200": 200 }[caseId];
      assert.equal(result.status, status); assert.equal(result.retryAfter, fault ? "2" : null);
      assert.deepEqual(result.error, fault ? { code: "PAYMENT_STATUS_UNKNOWN", retryable: true } : stage === "first" && caseId === "handler-throws" ? { code: "HANDLER_ERROR", retryable: false } : null);
      assert.equal(result.receiptValid, config.protocol === "x402" || status === 200);
      assert.equal(result.receiptSha256 === null, config.protocol === "mpp" && status !== 200);
      assert.equal(result.requests.length, n);
      for (const request of result.requests) assert.deepEqual(request, result.requests[0]);
      assert.deepEqual(merchantSnapshot.received, Array(n).fill(result.requests[0].credentialSha256));
    }
    assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
    const final = checkpoints.at(-1), totals = counters();
    for (const result of [final.buyer, final.merchant, final.facilitator]) for (const key of Object.keys(totals)) totals[key] += result.counters[key];
    const attempts = final.facilitator.fulfillmentAttempts, settlements = final.facilitator.settlementObservations, handlers = final.merchant.handlerObservations;
    assert.equal(attempts.length, checkpoints.length); assert.equal(settlements.length, checkpoints.length); assert.equal(handlers.length, checkpoints.length);
    for (let i = 0; i < checkpoints.length; i++) {
      const fault = i === 0 && caseId.startsWith("fulfillment-"), delivery = final.merchant.fulfillmentObservations[i];
      const responseStatus = !fault ? 200 : ["fulfillment-disconnect", "fulfillment-timeout"].includes(caseId) ? null : caseId === "fulfillment-unexpected-2xx" ? 204 : 503;
      assert.equal(attempts[i].responseStatus, responseStatus); assert.equal(attempts[i].acknowledged, !fault);
      assert.equal(delivery.responseStatus, responseStatus); assert.equal(delivery.acknowledged, !fault);
      assert.equal(delivery.transportError, fault && caseId === "fulfillment-timeout" ? "ABORT_ERR" : fault && caseId === "fulfillment-disconnect" ? "ECONNRESET" : null);
      assert.ok(BigInt(delivery.startedAtNs) < BigInt(attempts[i].atNs) && BigInt(attempts[i].atNs) < BigInt(delivery.completedAtNs));
      if (fault && caseId === "fulfillment-timeout") { const ms = Number(BigInt(delivery.completedAtNs) - BigInt(delivery.startedAtNs)) / 1e6; assert.ok(ms >= 4500 && ms < 8000); }
      assert.equal(attempts[i].paymentIdSha256, handlers[i].paymentIdSha256); assert.equal(handlers[i].paymentIdSha256, settlements[i].paymentIdSha256);
      assert.equal(settlements[i].economicSha256, settlements[0].economicSha256);
      assert.ok(BigInt(settlements[i].atNs) < BigInt(handlers[i].settlementAtNs) && BigInt(handlers[i].settlementAtNs) < BigInt(handlers[i].atNs) && BigInt(handlers[i].atNs) < BigInt(attempts[i].atNs));
      assert.equal(handlers[i].receiptInjected, i === 0 && config.protocol === "mpp" && ["handler-500", "handler-400", "handler-404", "handler-302"].includes(caseId));
    }
    await scenario.closeRoles([merchant, facilitator]);
    observation = { caseId, condition, status: "PASSED", retryOwner: "application-same-process-captured-request", roles: roles.map(role => role.identity), ports, tls: tlsControls, counters: totals, checkpoints };
  } catch (error) { failure = hash(String(error?.message)); }
  finally {
    const diagnostics = await scenario.cleanup();
    if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
    const result = failure ? { caseId, condition, status: "FAILED", failure, roles: roles.map(role => role.identity), checkpoints, ports, tls: tlsControls, diagnostics, roleFailures: roles.flatMap(role => role.failures) } : { ...observation, diagnostics };
    await writeFile(join(directory, "seller.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (failure) throw new Error("SELLER_SUBCASE_FAILED");
  }
  const result = JSON.parse(await readFile(join(directory, "seller.json")));
  return standardReceiptCaseId ? { ...result, caseId: standardReceiptCaseId, underlyingCaseId: caseId } : replayCaseId ? { ...result, caseId: replayCaseId, underlyingCaseId: caseId, path: "seller" } : result;
}

export async function runSellerSlice({ input, row, directory, assert, onReady }) {
  const catalog = sellerCases[row.slice(input.fixture.length + 1)]; assert.ok(catalog);
  const subcases = [];
  for (const caseId of catalog) {
    const results = await Promise.allSettled(["import", "require"].map(condition => sellerSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  return subcases;
}

export async function runCurrentHandlerFailure({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); const subcases = [];
  for (const caseId of profile.catalog) {
    const results = await Promise.allSettled(["import", "require"].map(condition => sellerSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady, handlerFailureFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  const expected = profile.catalog.flatMap(caseId => ["import", "require"].map(condition => [caseId, condition]));
  assert.deepEqual(subcases.map(value => [value.caseId, value.condition]), expected); assert.equal(subcases.length, 14); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

export async function runCurrentFulfillmentFailure({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); const subcases = [];
  for (const caseId of profile.catalog) {
    const results = await Promise.allSettled(["import", "require"].map(condition => sellerSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady, fulfillmentFailureFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  const expected = profile.catalog.flatMap(caseId => ["import", "require"].map(condition => [caseId, condition]));
  assert.deepEqual(subcases.map(value => [value.caseId, value.condition]), expected); assert.equal(subcases.length, 8); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

async function directStandardReceiptSubcase({ input, directory, caseId, condition, assert }) {
  await mkdir(directory, { mode: 0o700 }); const inventory = [];
  const pay = await publicModule(input.consumer.directory, "@0xkey-io/pay/mpp", condition, inventory);
  const wire = await publicModule(input.native, "mppx", condition, inventory);
  const method = pay.create0xkeyEvmChargeMethod({ network: "eip155:84532", organizationId: "11111111-1111-4111-8111-111111111111", payTo: "0x1111111111111111111111111111111111111111", stamper: { async stampRequest() { throw new Error("DIRECT_RECEIPT_MUST_NOT_STAMP"); } } });
  const responseStatus = caseId === "direct-wrapper-2xx-positive" ? 201 : 500;
  const caller = new Response("preserved bytes", { status: responseStatus, statusText: "Merchant Status", headers: { "Payment-Receipt": "injected", "Cache-Control": "no-store", "X-Merchant": "preserved" } });
  const originalBody = caller.body, receipt = { method: "evm", status: "success", reference: "0x" + "ab".repeat(32), timestamp: "2026-09-01T00:00:00.000Z" };
  const result = method.transport.respondReceipt({ receipt, response: caller });
  assert.ok(result instanceof Response); assert.equal(result.status, responseStatus); assert.equal(result.statusText, "Merchant Status"); assert.equal(result.body, originalBody); assert.equal(result.headers.get("X-Merchant"), "preserved"); assert.equal(result.headers.get("Cache-Control"), "no-store, private");
  assert.equal(result.headers.has("Payment-Receipt"), responseStatus < 300); if (responseStatus < 300) assert.equal(wire.Receipt.fromResponse(result).reference, receipt.reference);
  assert.equal(await result.text(), "preserved bytes"); assert.equal(caller.headers.get("Payment-Receipt"), "injected");
  const observation = { caseId, condition, status: "PASSED", inventory, responseStatus, receiptEmitted: responseStatus < 300, bodyPreserved: true, callerUnmodified: true };
  await writeFile(join(directory, "direct-receipt.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 }); return observation;
}

export async function runCurrentStandardWireReceipt({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); const subcases = [];
  for (const caseId of profile.catalog) {
    const results = await Promise.allSettled(["import", "require"].map(condition => caseId.startsWith("direct-wrapper-")
      ? directStandardReceiptSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert })
      : sellerSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId: "handler-200", condition, assert, onReady, standardReceiptCaseId: caseId })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  const expected = profile.catalog.flatMap(caseId => ["import", "require"].map(condition => [caseId, condition]));
  assert.deepEqual(subcases.map(value => [value.caseId, value.condition]), expected); assert.equal(subcases.length, profile.protocol === "mpp" ? 10 : 6); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

async function wireSubcase({ input, directory, caseId, condition, assert, onReady, networkMismatchFinal = false, mppNetworkMismatchFinal = false, amountMismatchFinal = false, mppAmountMismatchFinal = false, assetMismatchFinal = false, mppAssetMismatchFinal = false, payeeMismatchFinal = false, mppPayeeMismatchFinal = false, temporalValidityFinal = false }) {
  await mkdir(directory, { mode: 0o700 });
  const mpp = input.fixture.startsWith("mppx-"), config = { condition, protocol: mpp ? "mpp" : "x402", payBuyer: false, native: input.native, pay: input.consumer.directory, certificates: input.certificates, wireCaseId: caseId, wireStage: "negative", ...(networkMismatchFinal ? { networkMismatchFinal: true } : {}), ...(mppNetworkMismatchFinal ? { mppNetworkMismatchFinal: true } : {}), ...(amountMismatchFinal ? { amountMismatchFinal: true } : {}), ...(mppAmountMismatchFinal ? { mppAmountMismatchFinal: true } : {}), ...(assetMismatchFinal ? { assetMismatchFinal: true } : {}), ...(mppAssetMismatchFinal ? { mppAssetMismatchFinal: true } : {}), ...(payeeMismatchFinal ? { payeeMismatchFinal: true } : {}), ...(mppPayeeMismatchFinal ? { mppPayeeMismatchFinal: true } : {}), ...(temporalValidityFinal ? { temporalValidityFinal: true } : {}) };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  const checkpoints = []; let observation, failure;
  try {
    const facilitator = await spawnRole("scripted-facilitator"), merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
    for (const stage of ["negative", "positive"]) {
      if (stage === "positive") for (const role of [merchant, facilitator]) { role.send({ type: "configure", step: "proof" }); assert.equal((await role.take("configured")).step, "proof"); }
      const buyer = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, wireStage: stage });
      const result = await buyer.take("wire-result"); assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
      merchant.send({ type: "snapshot" }); const merchantSnapshot = await merchant.take("snapshot");
      facilitator.send({ type: "snapshot" }); const facilitatorSnapshot = await facilitator.take("snapshot");
      checkpoints.push({ buyer: { pid: buyer.child.pid, ...result }, merchant: merchantSnapshot, facilitator: facilitatorSnapshot });
      assert.equal(result.caseId, caseId); assert.equal(result.stage, stage);
      for (const snapshot of [merchantSnapshot, facilitatorSnapshot]) assert.deepEqual(snapshot.failures, []);
      const positive = stage === "positive", ambiguous = caseId === "both-credential-headers", challengeMutation = ["credential-offer-chain-mismatch", "credential-offer-asset-mismatch"].includes(caseId);
      assert.deepEqual([result.counters.sign, result.counters.signedSend, result.counters.save, result.counters.clear, result.counters.rpc, result.wrapperCalls], [temporalValidityFinal && !positive ? 2 : 1, 1, 0, 0, 0, 1]);
      assert.equal(result.status, positive ? 200 : temporalValidityFinal ? 402 : ambiguous || !mpp && !challengeMutation ? 400 : 402);
      assert.equal(result.classification, positive ? "paid" : temporalValidityFinal ? mpp ? "verification-failed" : "temporal-rejected" : ambiguous ? "AMBIGUOUS_PAYMENT_CREDENTIAL" : mpp ? caseId === "selected-malformed-credential" ? "malformed-credential" : challengeMutation ? mppNetworkMismatchFinal ? "verification-failed" : "invalid-challenge" : "verification-failed" : challengeMutation ? "no-matching-requirements" : "PAYMENT_CREDENTIAL_INVALID");
      assert.equal(result.challenge, !positive && !ambiguous && (mpp || challengeMutation || temporalValidityFinal)); assert.equal(result.receiptValid, positive); assert.equal(result.receiptSha256 === null, !positive);
      assert.deepEqual([merchantSnapshot.counters.handler, merchantSnapshot.counters.applicationEffect, facilitatorSnapshot.counters.verify, facilitatorSnapshot.counters.settle, facilitatorSnapshot.counters.economicEffect, facilitatorSnapshot.counters.fulfillment], positive ? [1, 1, mpp ? 0 : temporalValidityFinal ? 2 : 1, 1, 1, 1] : temporalValidityFinal && !mpp ? [0, 0, 1, 0, 0, 0] : [0, 0, 0, 0, 0, 0]);
      const arrivals = merchantSnapshot.wireArrivals.filter(value => value.stage === stage);
      assert.equal(arrivals.length, 2); assert.equal(arrivals[0].protocol, null); assert.equal(arrivals[1].protocol, !positive && ambiguous ? "both" : config.protocol);
      assert.equal(arrivals[1].credentialSha256, result.wire.transmittedSha256); assert.equal(arrivals[1].credentialHeadersSha256, result.wire.credentialHeadersSha256); assert.equal(arrivals[1].bodySha256, result.wire.bodySha256);
      assert.equal(arrivals[1].responseStatus, result.status);
      for (const arrival of arrivals) assert.ok(BigInt(arrival.atNs) < BigInt(arrival.bodyReadAtNs) && BigInt(arrival.bodyReadAtNs) < BigInt(arrival.completedAtNs));
      assert.ok(BigInt(result.events.find(event => event.event === "sign").atNs) < BigInt(arrivals[1].atNs));
      assert.equal(result.wire.originalSha256 === result.wire.transmittedSha256, positive || ambiguous);
      assert.equal(result.wire.originalHeadersSha256 === result.wire.transmittedHeadersSha256, positive);
      assert.equal(result.wire.unchangedBeforeSha256, result.wire.unchangedAfterSha256); assert.equal(result.wire.envelopeBeforeSha256, result.wire.envelopeAfterSha256);
      const privateArrivals = facilitatorSnapshot.wirePrivateArrivals.filter(value => value.stage === stage);
      assert.deepEqual(privateArrivals.map(value => value.operation), positive ? mpp ? ["charge", "fulfillment"] : ["verify", "charge", "fulfillment"] : temporalValidityFinal ? mpp ? [] : ["supported", "verify"] : mpp ? [] : ["supported"]);
      for (const arrival of privateArrivals) {
        assert.ok(BigInt(arrival.atNs) < BigInt(arrival.bodyReadAtNs) && BigInt(arrival.bodyReadAtNs) < BigInt(arrival.stampMetadataValidatedAtNs) && BigInt(arrival.stampMetadataValidatedAtNs) < BigInt(arrival.completedAtNs));
        assert.equal(arrival.responseStatus, 200); assert.equal(arrival.authorizationValidatedAtNs !== null, ["verify", "charge"].includes(arrival.operation));
        if (arrival.authorizationValidatedAtNs !== null) assert.ok(BigInt(arrival.stampMetadataValidatedAtNs) < BigInt(arrival.authorizationValidatedAtNs) && BigInt(arrival.authorizationValidatedAtNs) < BigInt(arrival.completedAtNs));
      }
    }
    assert.ok(checkpoints[0].buyer.pid !== checkpoints[1].buyer.pid);
    const totals = counters(), final = checkpoints[1];
    for (const value of [...checkpoints.map(checkpoint => checkpoint.buyer), final.merchant, final.facilitator]) for (const key of Object.keys(totals)) totals[key] += value.counters[key];
    await scenario.closeRoles([merchant, facilitator]);
    observation = { caseId, condition, status: "PASSED", sendOwner: "native-first-send-wire-mutator", calibrationOwner: "fresh-native-buyer", roles: roles.map(role => role.identity), ports, tls: tlsControls, counters: totals, checkpoints };
  } catch (error) { failure = hash(String(error?.message)); }
  finally {
    const diagnostics = await scenario.cleanup();
    if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
    const result = failure ? { caseId, condition, status: "FAILED", failure, roles: roles.map(role => role.identity), checkpoints, ports, tls: tlsControls, diagnostics, roleFailures: roles.flatMap(role => role.failures) } : { ...observation, diagnostics };
    await writeFile(join(directory, "wire.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (failure) throw new Error("WIRE_SUBCASE_FAILED");
  }
  return JSON.parse(await readFile(join(directory, "wire.json")));
}

export async function runWireSlice({ input, row, directory, assert, onReady }) {
  const catalog = wireCases[row.slice(input.fixture.length + 1)]; assert.ok(catalog);
  const subcases = [];
  for (const caseId of catalog) {
    const results = await Promise.allSettled(["import", "require"].map(condition => wireSubcase({ input, directory: join(directory, caseId + "-" + condition), caseId, condition, assert, onReady })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push(result.value); }
  }
  return subcases;
}

export async function runCurrentX402NetworkMismatch({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); const subcases = [];
  const runners = { offer: offerSubcase, wire: wireSubcase, restart: preflightSubcase };
  for (const [path, caseIds] of Object.entries(profile.catalog)) for (const caseId of caseIds) {
    const results = await Promise.allSettled(["import", "require"].map(condition => runners[path]({ input, directory: join(directory, path + "-" + caseId + "-" + condition), caseId, condition, assert, onReady, networkMismatchFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push({ ...result.value, path }); }
  }
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

export async function runCurrentMppNetworkMismatch({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); const subcases = [];
  const runners = { offer: offerSubcase, wire: wireSubcase, restart: preflightSubcase };
  for (const [path, caseIds] of Object.entries(profile.catalog)) for (const caseId of caseIds) {
    const results = await Promise.allSettled(["import", "require"].map(condition => runners[path]({ input, directory: join(directory, path + "-" + caseId + "-" + condition), caseId, condition, assert, onReady, mppNetworkMismatchFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push({ ...result.value, path }); }
  }
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

export async function runCurrentTemporalValidity({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); assert.deepEqual(profile.catalog, currentTemporalValidityCases[profile.protocol]);
  const subcases = [], runners = { offer: offerSubcase, wire: wireSubcase };
  for (const [path, caseIds] of Object.entries(profile.catalog)) for (const caseId of caseIds) {
    const results = await Promise.allSettled(["import", "require"].map(condition => runners[path]({ input, directory: join(directory, path + "-" + caseId + "-" + condition), caseId, condition, assert, onReady, temporalValidityFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push({ ...result.value, path }); }
  }
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

async function replayBuyerSubcase({ input, directory, caseId, condition, assert, onReady }) {
  await mkdir(directory, { mode: 0o700 });
  const config = { condition, protocol: input.fixture.startsWith("mppx-") ? "mpp" : "x402", payBuyer: true, native: input.native, pay: input.consumer.directory, certificates: input.certificates, replayFinal: true, replayCaseId: caseId, replayStage: "initial" };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  const buyers = [], checkpoints = []; let observation, failure, persistedAfterFirst = null, persistedAfterReplay = null;
  try {
    const facilitator = await spawnRole("scripted-facilitator"), merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
    merchant.send({ type: "configure", step: "missing" }); assert.equal((await merchant.take("configured")).step, "missing");
    const store = join(directory, "durable"); initializeStore(store);
    const firstRole = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store, replayStage: "initial" });
    const first = { pid: firstRole.child.pid, ...await firstRole.take("replay-result") }; buyers.push(first);
    assert.deepEqual([first.stage, first.status, first.errorCode, first.pending, first.receiptSha256, first.receiptValid], ["first", null, "PAYMENT_RECEIPT_MISSING", true, null, false]);
    persistedAfterFirst = await persisted(store, config.protocol); assert.ok(persistedAfterFirst);
    merchant.send({ type: "configure", step: "proof" }); assert.equal((await merchant.take("configured")).step, "proof");
    let replayRole = firstRole;
    if (caseId === "same-process-replay") firstRole.send({ type: "replay-proceed", caseId });
    else { assert.deepEqual(await firstRole.close, { code: 0, signal: null, reason: null }); replayRole = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store, replayStage: "resume" }); }
    const replay = { pid: replayRole.child.pid, ...await replayRole.take("replay-result") }; buyers.push(replay);
    assert.deepEqual([replay.stage, replay.status, replay.errorCode, replay.pending, replay.receiptValid], ["replay", 200, null, false, true]); assert.ok(replay.receiptSha256);
    assert.deepEqual(await replayRole.close, { code: 0, signal: null, reason: null });
    assert.equal(first.credentialSha256, replay.credentialSha256); assert.equal(first.recordSha256, replay.recordSha256);
    assert.equal(first.credentialSha256, persistedAfterFirst.credentialSha256); assert.equal(first.recordSha256, persistedAfterFirst.recordSha256);
    assert.equal(caseId === "same-process-replay" ? first.pid === replay.pid : first.pid !== replay.pid, true);
    persistedAfterReplay = await persisted(store, config.protocol); assert.equal(persistedAfterReplay, null);
    const snapshots = {};
    for (const role of [merchant, facilitator]) { role.send({ type: "snapshot" }); snapshots[role.role === "merchant" ? "merchant" : "facilitator"] = await role.take("snapshot"); }
    checkpoints.push(snapshots); for (const value of Object.values(snapshots)) assert.deepEqual(value.failures, []);
    assert.deepEqual([snapshots.merchant.counters.handler, snapshots.merchant.counters.applicationEffect, snapshots.merchant.counters.challenge], [2, 1, 1]);
    assert.deepEqual([snapshots.facilitator.counters.settle, snapshots.facilitator.counters.economicEffect, snapshots.facilitator.counters.verify, snapshots.facilitator.counters.rpc], [2, 1, 0, 4]);
    assert.deepEqual(snapshots.merchant.received, [first.credentialSha256, first.credentialSha256]);
    const totals = counters(), buyerTotals = caseId === "same-process-replay" ? [replay] : buyers; for (const value of [...buyerTotals, snapshots.merchant, snapshots.facilitator]) for (const key of Object.keys(totals)) totals[key] += value.counters[key]; totals.rpc = snapshots.facilitator.counters.rpc;
    assert.deepEqual([totals.sign, totals.save, totals.signedSend, totals.clear, totals.settle, totals.handler, totals.economicEffect, totals.applicationEffect], [1, 1, 2, 1, 2, 2, 1, 1]);
    await scenario.closeRoles([merchant, facilitator]);
    observation = { path: "buyer", caseId, condition, status: "PASSED", roles: roles.map(role => role.identity), ports, tls: tlsControls, counters: totals, buyers, persistedAfterFirst, persistedAfterReplay, checkpoints };
  } catch (error) { failure = hash(String(error?.message)); }
  finally {
    const diagnostics = await scenario.cleanup(); if (diagnostics.some(role => role.stdout.bytes || role.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
    const result = failure ? { path: "buyer", caseId, condition, status: "FAILED", failure, roles: roles.map(role => role.identity), ports, tls: tlsControls, buyers, checkpoints, diagnostics, roleFailures: roles.flatMap(role => role.failures) } : { ...observation, diagnostics };
    await writeFile(join(directory, "replay.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 }); if (failure) throw new Error("REPLAY_BUYER_SUBCASE_FAILED");
  }
  return JSON.parse(await readFile(join(directory, "replay.json")));
}

export async function runCurrentReplay({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); const subcases = [];
  for (const caseId of currentReplayCases.buyer) for (const condition of ["import", "require"]) subcases.push(await replayBuyerSubcase({ input, directory: join(directory, "buyer-" + caseId + "-" + condition), caseId, condition, assert, onReady }));
  for (const caseId of currentReplayCases.seller) for (const condition of ["import", "require"]) subcases.push(await sellerSubcase({ input, directory: join(directory, "seller-" + caseId + "-" + condition), caseId: "handler-500", replayCaseId: caseId, condition, assert, onReady }));
  for (const caseId of currentReplayCases.owner) for (const condition of ["import", "require"]) subcases.push({ ...await claimSubcase({ input, directory: join(directory, "owner-" + caseId + "-" + condition), caseId, condition, assert, onReady, replayFinal: true }), path: "owner" });
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(subcases.length, 10); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

export async function runCurrentX402AmountMismatch({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); assert.deepEqual(profile.catalog, currentX402AmountMismatchCases); const subcases = [];
  const runners = { offer: offerSubcase, wire: wireSubcase };
  for (const [path, caseIds] of Object.entries(profile.catalog)) for (const caseId of caseIds) {
    const results = await Promise.allSettled(["import", "require"].map(condition => runners[path]({ input, directory: join(directory, path + "-" + caseId + "-" + condition), caseId, condition, assert, onReady, amountMismatchFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push({ ...result.value, path }); }
  }
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(subcases.length, 10); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

export async function runCurrentX402PayeeMismatch({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); assert.deepEqual(profile.catalog, currentX402PayeeMismatchCases); const subcases = [];
  const runners = { offer: offerSubcase, wire: wireSubcase };
  for (const [path, caseIds] of Object.entries(profile.catalog)) for (const caseId of caseIds) {
    const results = await Promise.allSettled(["import", "require"].map(condition => runners[path]({ input, directory: join(directory, path + "-" + caseId + "-" + condition), caseId, condition, assert, onReady, payeeMismatchFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push({ ...result.value, path }); }
  }
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(subcases.length, 4); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}


export async function runCurrentMppPayeeMismatch({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); assert.deepEqual(profile.catalog, currentMppPayeeMismatchCases); const subcases = [];
  const runners = { offer: offerSubcase, wire: wireSubcase };
  for (const [path, caseIds] of Object.entries(profile.catalog)) for (const caseId of caseIds) {
    const results = await Promise.allSettled(["import", "require"].map(condition => runners[path]({ input, directory: join(directory, path + "-" + caseId + "-" + condition), caseId, condition, assert, onReady, mppPayeeMismatchFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push({ ...result.value, path }); }
  }
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(subcases.length, 4); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

export async function runCurrentMppAmountMismatch({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); assert.deepEqual(profile.catalog, currentMppAmountMismatchCases); const subcases = [];
  const runners = { offer: offerSubcase, wire: wireSubcase };
  for (const [path, caseIds] of Object.entries(profile.catalog)) for (const caseId of caseIds) {
    const results = await Promise.allSettled(["import", "require"].map(condition => runners[path]({ input, directory: join(directory, path + "-" + caseId + "-" + condition), caseId, condition, assert, onReady, mppAmountMismatchFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push({ ...result.value, path }); }
  }
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(subcases.length, 10); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}

export async function runCurrentX402AssetMismatch({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); assert.deepEqual(profile.catalog, currentX402AssetMismatchCases); const subcases = [];
  const runners = { offer: offerSubcase, wire: wireSubcase };
  for (const [path, caseIds] of Object.entries(profile.catalog)) for (const caseId of caseIds) {
    const results = await Promise.allSettled(["import", "require"].map(condition => runners[path]({ input, directory: join(directory, path + "-" + caseId + "-" + condition), caseId, condition, assert, onReady, assetMismatchFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push({ ...result.value, path }); }
  }
  assert.equal(subcases.length, 6); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}
export async function runCurrentMppAssetMismatch({ input, directory, assert, onReady, profile }) {
  assert.equal(input.fixture, profile.fixture); assert.equal(input.stage, "final-7b"); assert.deepEqual(profile.catalog, currentMppAssetMismatchCases); const subcases = [];
  const runners = { offer: offerSubcase, wire: wireSubcase };
  for (const [path, caseIds] of Object.entries(profile.catalog)) for (const caseId of caseIds) {
    const results = await Promise.allSettled(["import", "require"].map(condition => runners[path]({ input, directory: join(directory, path + "-" + caseId + "-" + condition), caseId, condition, assert, onReady, mppAssetMismatchFinal: true })));
    for (const result of results) { if (result.status === "rejected") throw result.reason; subcases.push({ ...result.value, path }); }
  }
  assert.equal(subcases.length, 8); assert.equal(subcases.every(value => value.status === "PASSED"), true); return subcases;
}
