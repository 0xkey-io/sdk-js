import assert from "node:assert/strict";
import { readFileSync, copyFileSync, constants } from "node:fs";
import { join } from "node:path";
import { boot, certificates, send, receive, counters, tlsFetch, hash, network, transaction } from "./common.mjs";
import { durableStore } from "./durable-store.mjs";
import { selectionFromChallenge, selectionFromCredential } from "./mpp-authorization-selection.mjs";

const count = counters();
let lastStatus = null;
try {
  const { config, modules, inventory } = await boot(async (config, load) => {
    const base = { accounts: await load(config.payBuyer ? config.pay : config.native, "viem/accounts"), wire: await load(config.native, config.protocol === "mpp" ? "mppx" : "@x402/core/http") };
    if (config.payBuyer) return { ...base, pay: await load(config.pay, "@0xkey-io/pay/client"), ...config.authorizationOffer ? { authorizationEvm: await load(config.native, "@x402/evm/exact/client") } : {}, ...(config.networkMismatchFinal || config.amountMismatchFinal || config.assetMismatchFinal || config.payeeMismatchFinal) && config.protocol === "x402" ? { networkEvm: await load(config.native, "@x402/evm/exact/client") } : {}, ...config.dualCaseId && config.dualCaseId !== "duplicate-incompatible-offers" ? { auxiliaryWire: await load(config.pay, config.protocol === "x402" ? "mppx" : "@x402/core/http") } : {} };
    if (config.protocol === "mpp") return { ...base, client: await load(config.native, "mppx/client"), evm: await load(config.native, "mppx/evm"), method: await load(config.native, "mppx/evm/client"), ...config.supportCaseId ? { auxiliaryWire: await load(config.pay, "@x402/core/http") } : {} };
    return { ...base, client: await load(config.native, "@x402/core/client"), evm: await load(config.native, "@x402/evm/exact/client"), fetch: await load(config.native, "@x402/fetch") };
  });
  const events = [], requests = [], tls = await certificates(config.certificates);
  const supportTimeout = config.supportCaseId === "S-supported-timeout" && config.supportStage === "negative";
  const transport = tlsFetch(tls.ca, new Set(config.sellerCaseId === "fulfillment-timeout" || config.supportCaseId ? [config.merchant] : [config.merchant, config.facilitator]), config.freezeCaseId?.startsWith("redirect-") || config.sellerCaseId === "handler-302" ? "manual-response" : "reject", supportTimeout ? "support-discovery-observer" : config.sellerCaseId === "fulfillment-timeout" ? "seller-fulfillment-observer" : "standard");
  const supportChallenges = [], signedProtocols = []; let nativeChallengeId, selectedChallengeSha256 = null;
  let capturedRequest, wrapperCalls = 0;
  let wireEvidence;
  let authorizationTargetSelector, authorizationActualSelector;
  let mppAuthorizationTargetSelection, mppAuthorizationActualSelection;
  const authorizationControl = config.authorizationCaseId || config.authorizationOffer;
  const authorizationOwner = authorizationControl ? `@x402/evm@${inventory.find(entry => entry.name === "@x402/evm/exact/client")?.version}` : null;
  if (authorizationControl) {
    assert.match(authorizationOwner, /^@x402\/evm@2\.(22|23)\.0$/);
    const caseId = config.authorizationCaseId ?? config.offerCaseId;
    const stage = config.authorizationStage ?? config.offerStage;
    if (stage === "negative") {
      const value = caseId === "upto" ? "upto" : caseId === "permit2" ? "permit2" : "future-transfer";
      authorizationTargetSelector = { field: caseId === "upto" ? "accepts.scheme" : "accepts.extra.assetTransferMethod", valueSha256: hash(value), owner: authorizationOwner };
    }
  }
  if (config.networkMismatchFinal) assert.match(`@x402/evm@${inventory.find(entry => entry.name === "@x402/evm/exact/client")?.version}`, /^@x402\/evm@2\.(22|23)\.0$/);
  if (config.amountMismatchFinal) assert.match(`@x402/evm@${inventory.find(entry => entry.name === "@x402/evm/exact/client")?.version}`, /^@x402\/evm@2\.(22|23)\.0$/);
  if (config.assetMismatchFinal) assert.match(`@x402/evm@${inventory.find(entry => entry.name === "@x402/evm/exact/client")?.version}`, /^@x402\/evm@2\.(22|23)\.0$/);
  if (config.payeeMismatchFinal) assert.match(`@x402/evm@${inventory.find(entry => entry.name === "@x402/evm/exact/client")?.version}`, /^@x402\/evm@2\.(22|23)\.0$/);
  if (config.mppNetworkMismatchFinal) assert.match(`mppx@${inventory.find(entry => entry.name === "mppx")?.version}`, /^mppx@0\.8\.(17|19)$/);
  if (config.mppAssetMismatchFinal) assert.match(`mppx@${inventory.find(entry => entry.name === "mppx")?.version}`, /^mppx@0\.8\.(17|19)$/);
  if (config.mppPayeeMismatchFinal) assert.match(`mppx@${inventory.find(entry => entry.name === "mppx")?.version}`, /^mppx@0\.8\.(17|19)$/);
  if (config.mppAmountMismatchFinal) assert.match(`mppx@${inventory.find(entry => entry.name === "mppx")?.version}`, /^mppx@0\.8\.(17|19)$/);
  const sellerRequests = [];
  const preflightTransports = [], preflightRequests = [], bodyFailure = new Error("OWNED_BODY_STREAM_FAILURE");
  const dualOffers = [], dualSent = []; let dualSaved;
  const realmOffers = [], realmSent = []; let realmSaved;
  const duplicateCase = config.dualCaseId === "duplicate-incompatible-offers";
  const dualSelected = duplicateCase ? config.protocol : config.dualCaseId?.endsWith("-x402") ? "x402" : "mpp";
  const preference = config.dualCaseId && !duplicateCase ? [dualSelected, dualSelected === "x402" ? "mpp" : "x402"] : [config.protocol];
  const configuredNetwork = config.preflightStage === "incompatible" ? "eip155:8453" : network;
  const account = modules.accounts.privateKeyToAccount(config.payBuyer ? readFileSync(join(config.store, "signer.key"), "utf8") : "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  let lastTypedData = null;
  const signer = { address: account.address, async signTypedData(...args) { count.sign++; lastTypedData = structuredClone(args[0]); assert.ok((!config.step || ["save-before-send-exit", "settle-unknown-capture"].includes(config.step) || config.settleUnknownFinal === true && config.payBuyer === false && config.step === "accepted-503") && config.freezeStage !== "resume" && config.receiptStage !== "proof" && config.replayStage !== "resume" && !["incompatible", "resume"].includes(config.preflightStage), "RESIGN_FORBIDDEN"); const signature = await account.signTypedData(...args); events.push({ event: "sign", atNs: process.hrtime.bigint().toString() }); return signature; } };
  let credentialSha256, receiptSha256 = null, receiptValid = false, receiptFields = [], recordSha256;
  let client, saveAttempts = 0, saveOutcome, storageError = null, candidateCredentialSha256, candidateRecordSha256, competingCall;
  let clearAttempts = 0, sentCiphertextSha256;
  const verifierCalls = [], verifierFailure = new Error("SYNTHETIC_VERIFIER_SECRET");
  async function observeCall(operation) {
    try {
      const response = await operation();
      assert.equal(response.status, 200); assert.equal(await response.text(), "paid");
      return { status: response.status, errorCode: null };
    } catch (error) {
      if (!["PAYMENT_IN_PROGRESS", "PENDING_PAYMENT_CLAIMED", "PAYMENT_RECEIPT_MISSING", "PAYMENT_SERVICE_UNAVAILABLE"].includes(error.code)) throw error;
      return { status: null, errorCode: error.code };
    }
  }
  const credentialHeader = config.protocol === "mpp" ? "authorization" : "payment-signature";
  const durable = config.payBuyer ? durableStore(config.store, (name, digest) => { count[name]++; assert.match(digest, /^0x[0-9a-f]{64}$/); recordSha256 = digest.slice(2); events.push({ event: name, atNs: process.hrtime.bigint().toString() }); }, () => (!config.step || ["proof", "verified-resume"].includes(config.step)) && count.rpc === 4 && receiptValid) : undefined;
  const store = durable && { ...durable, async clear(digest) { clearAttempts++; return durable.clear(digest); }, async saveIfAbsent(record) {
    if (config.offerCaseId || config.preflightCaseId || config.dualCaseId || config.realmCaseId) saveAttempts++;
    if (config.caseId) {
      saveAttempts++;
      candidateCredentialSha256 = hash(record.payment.headers.find(([name]) => name === credentialHeader)[1]);
      candidateRecordSha256 = record.digest.slice(2);
      send({ type: "claim-ready", caseId: config.caseId, counters: count, saveAttempts, candidateCredentialSha256, candidateRecordSha256 });
      assert.deepEqual(await receive(), { type: "claim-release", caseId: config.caseId });
      if (config.caseId === "single-client-singleflight") competingCall = await observeCall(() => client.fetch(config.merchant + "/paid"));
      let saved = false, failure;
      if (config.caseId === "save-if-absent-throws") {
        failure = new Error("SYNTHETIC_CLAIM_STORE_SECRET"); storageError = "CONTROLLED_THROW";
      } else if (config.caseId !== "save-if-absent-false") {
        try { saved = await durable.saveIfAbsent(record); }
        catch (error) { assert.equal(error.code, "EEXIST"); failure = error; storageError = "EEXIST"; }
      }
      saveOutcome = failure ? "threw" : saved ? "saved" : "occupied";
      send({ type: "claim-decided", caseId: config.caseId, saveOutcome, storageError });
      // Both atomic attempts finish before the supervisor observes the slot.
      // Releasing the loser first only serializes post-claim SDK handling,
      // never the two actual durable save attempts.
      assert.deepEqual(await receive(), { type: "claim-proceed", caseId: config.caseId });
      if (failure) throw failure;
      return saved;
    }
    const saved = await durable.saveIfAbsent(record);
    if (saved && config.billingRecovery) copyFileSync(join(config.store, "pending.aead"), join(config.store, "recovery-saved.aead"), constants.COPYFILE_EXCL);
    if (saved && config.realmCaseId) {
      assert.equal(record.payment.protocolId, "mpp-evm-charge-v0"); assert.equal(record.payment.network, network);
      copyFileSync(join(config.store, "pending.aead"), join(config.store, "realm-saved.aead"), constants.COPYFILE_EXCL);
      realmSaved = { protocol: "mpp", protocolId: record.payment.protocolId, network: record.payment.network, credentialSha256: hash(record.payment.headers.find(([name]) => name === "authorization")[1]), recordSha256: record.digest.slice(2), ciphertextSha256: hash(readFileSync(join(config.store, "realm-saved.aead"))), keySha256: hash(readFileSync(join(config.store, "storage.key"))), economicSha256: record.payment.economicEffectDigest.slice(2) };
    }
    if (saved && config.dualCaseId) {
      const protocol = record.payment.protocolId === "x402-exact-v2-eip3009" ? "x402" : "mpp";
      const header = protocol === "x402" ? "payment-signature" : "authorization";
      copyFileSync(join(config.store, "pending.aead"), join(config.store, "dual-saved.aead"), constants.COPYFILE_EXCL);
      dualSaved = { protocol, protocolId: record.payment.protocolId, network: record.payment.network, credentialSha256: hash(record.payment.headers.find(([name]) => name === header)[1]), recordSha256: record.digest.slice(2), ciphertextSha256: hash(readFileSync(join(config.store, "dual-saved.aead"))), keySha256: hash(readFileSync(join(config.store, "storage.key"))) };
    }
    if (saved && (["save-before-send-exit", "settle-unknown-capture"].includes(config.step) || config.freezeStage === "capture" || config.preflightStage === "capture")) {
      assert.equal(count.signedSend, 0);
      // Keep this capture's existing IPC handle alive until the
      // supervisor kills it; an unresolved top-level await is not a handle.
      process.channel.ref();
      credentialSha256 = hash(record.payment.headers.find(([name]) => name === credentialHeader)[1]);
      send(config.preflightStage === "capture" ? { type: "preflight-prepared", counters: count, events, credentialSha256, recordSha256, saveAttempts, requests: preflightRequests, transports: preflightTransports, network: configuredNetwork } : { type: "prepared", counters: count, events, credentialSha256, recordSha256 });
      // The public store callback has durably written and authenticated the
      // record, but never returns control to the SDK's signed-send path. The
      // supervising process kills this buyer, then a fresh buyer resumes.
      await new Promise(() => {});
    }
    return saved;
  } };
  const fetch = async (input, init) => {
    let request = new Request(input, init);
    if (config.realmCaseId) assert.equal(request.headers.has("payment-signature"), false, "X402_CREDENTIAL_FORBIDDEN");
    const actualHeader = config.dualCaseId && request.headers.has("payment-signature") ? "payment-signature" : config.dualCaseId && request.headers.has("authorization") ? "authorization" : credentialHeader;
    if (config.dualCaseId) assert.equal(request.headers.has("payment-signature") && request.headers.has("authorization"), false);
    const header = request.headers.get(actualHeader);
    let requestNetwork = null;
    if (header) {
      count.signedSend++; credentialSha256 = hash(header);
      if (authorizationControl) {
        const transmitted = modules.wire.decodePaymentSignatureHeader(header);
        authorizationActualSelector = { scheme: transmitted.accepted.scheme, assetTransferMethod: transmitted.accepted.extra?.assetTransferMethod, owner: authorizationOwner };
      }
      if (config.mppAuthorizationCaseId && config.mppAuthorizationStage === "positive" || config.mppAuthorizationOffer && config.offerStage === "positive") {
        const owner = `mppx@${inventory.find(entry => entry.name === "mppx")?.version}`; assert.ok(["mppx@0.8.19", "mppx@0.8.17"].includes(owner));
        mppAuthorizationActualSelection = selectionFromCredential(modules.wire, header, owner);
      }
      if (config.supportCaseId) {
        const protocol = request.headers.has("payment-signature") ? "x402" : "mpp";
        assert.equal(protocol, config.protocol); assert.equal(request.headers.has("payment-signature") && request.headers.has("authorization"), false);
        signedProtocols.push(protocol);
      }
      if (config.sellerCaseId) {
        // Capture the actual wrapper-created request before transport consumes
        // it. Only the application transport sends this retained clone again.
        capturedRequest ??= request.clone();
        sellerRequests.push({ method: request.method, urlSha256: hash(request.url), headersSha256: hash(JSON.stringify([...request.headers])), bodySha256: hash(Buffer.from(await request.clone().arrayBuffer())), credentialSha256 });
      }
      if (store) {
        const record = await store.load(); assert.ok(record);
        assert.equal(record.payment.headers.some(([name, value]) => name === actualHeader && value === header), true);
        requestNetwork = record.payment.network; recordSha256 = record.digest.slice(2);
        if (config.receiptCaseId) sentCiphertextSha256 = hash(readFileSync(join(config.store, "pending.aead")));
        if (config.dualCaseId) dualSent.push({ protocol: actualHeader === "payment-signature" ? "x402" : "mpp", credentialSha256, recordSha256 });
        if (config.realmCaseId) realmSent.push({ protocol: "mpp", credentialSha256, recordSha256 });
      }
      events.push({ event: "signedSend", atNs: process.hrtime.bigint().toString() });
      if (config.wireDecoderCaseId) {
        assert.equal(count.signedSend, 1, "WIRE_DECODER_FIRST_SIGNED_SEND_ONLY");
        const original = header, before = request, headers = new Headers(before.headers);
        const noncredential = value => hash(JSON.stringify([...value.headers].filter(([name]) => name !== actualHeader)));
        const binding = value => hash(JSON.stringify([value.method, value.url]));
        const positive = config.wireDecoderStage === "positive", encoding = config.wireDecoderCaseId === "credential-invalid-encoding";
        if (!positive) headers.set(actualHeader, config.protocol === "mpp" ? "Payment " + (encoding ? "%" : "ew") : encoding ? "%" : "ew==");
        const bodyBeforeSha256 = hash(Buffer.from(await before.clone().arrayBuffer()));
        request = new Request(before, { headers });
        wireEvidence = { field: positive ? "none" : encoding ? "selected-credential-encoding" : "selected-credential-json", originalSha256: hash(original), transmittedSha256: hash(headers.get(actualHeader)), originalHeadersSha256: hash(JSON.stringify([...before.headers])), transmittedHeadersSha256: hash(JSON.stringify([...headers])), credentialHeadersSha256: hash(JSON.stringify([headers.get("payment-signature"), headers.get("authorization")])), bodyBeforeSha256, bodyAfterSha256: hash(Buffer.from(await request.clone().arrayBuffer())), bindingBeforeSha256: binding(before), bindingAfterSha256: binding(request), noncredentialBeforeSha256: noncredential(before), noncredentialAfterSha256: noncredential(request) };
      }
      if (config.wireCaseId) {
        assert.equal(count.signedSend, 1, "WIRE_FIRST_SIGNED_SEND_ONLY");
        const mpp = config.protocol === "mpp", original = header;
        const originalHeadersSha256 = hash(JSON.stringify([...request.headers]));
        if (mpp && config.mppAssetMismatchFinal) {
          assert.equal(config.wireCaseId, "credential-offer-asset-mismatch");
          const decoded = modules.wire.Credential.deserialize(original), changed = structuredClone(decoded), headers = new Headers(request.headers);
          assert.match(decoded.challenge.request.currency, /^0x[0-9a-fA-F]{40}$/); let field = "none";
          if (config.wireStage === "negative") { changed.challenge.request.currency = "0x2222222222222222222222222222222222222222"; field = "challenge.request.currency"; }
          headers.set(actualHeader, modules.wire.Credential.serialize(changed));
          const transmitted = modules.wire.Credential.deserialize(headers.get(actualHeader)); assert.equal(modules.wire.Credential.serialize(transmitted), headers.get(actualHeader));
          const challengeRemainder = value => { const challenge = structuredClone(value); challenge.request.currency = null; return hash(JSON.stringify(challenge)); };
          const bodySha256 = hash(Buffer.from(await request.clone().arrayBuffer())); request = new Request(request, { headers });
          const challengeRemainderBeforeSha256 = challengeRemainder(decoded.challenge), challengeRemainderAfterSha256 = challengeRemainder(transmitted.challenge);
          const payloadBeforeSha256 = hash(JSON.stringify(decoded.payload)), payloadAfterSha256 = hash(JSON.stringify(transmitted.payload));
          wireEvidence = { field, originalSha256: hash(original), transmittedSha256: hash(headers.get(actualHeader)), originalHeadersSha256, transmittedHeadersSha256: hash(JSON.stringify([...headers])), credentialHeadersSha256: hash(JSON.stringify([headers.get("payment-signature"), headers.get("authorization")])), bodySha256, unchangedBeforeSha256: hash(JSON.stringify([challengeRemainderBeforeSha256, decoded.payload, decoded.source])), unchangedAfterSha256: hash(JSON.stringify([challengeRemainderAfterSha256, transmitted.payload, transmitted.source])), envelopeBeforeSha256: payloadBeforeSha256, envelopeAfterSha256: payloadAfterSha256, decodedAssetSha256: hash(transmitted.challenge.request.currency), codecOwner: `mppx@${inventory.find(entry => entry.name === "mppx")?.version}`, decoder: "Credential.deserialize", encoder: "Credential.serialize", challengeRemainderBeforeSha256, challengeRemainderAfterSha256, payloadBeforeSha256, payloadAfterSha256 };
        } else if (mpp && (config.mppPayeeMismatchFinal || config.mppAmountMismatchFinal)) {
          const payee = config.mppPayeeMismatchFinal;
          assert.equal(config.wireCaseId, payee ? "credential-offer-recipient-mismatch" : "credential-offer-amount-mismatch");
          const decoded = modules.wire.Credential.deserialize(original), changed = structuredClone(decoded), headers = new Headers(request.headers);
          if (payee) assert.match(decoded.payload.to, /^0x[0-9a-fA-F]{40}$/); else assert.equal(decoded.payload.value, "10000");
          let field = "none";
          if (config.wireStage === "negative") {
            changed.payload[payee ? "to" : "value"] = payee ? "0x2222222222222222222222222222222222222222" : "10001";
            field = payee ? "payload.to" : "payload.value";
          }
          headers.set(actualHeader, modules.wire.Credential.serialize(changed));
          const transmitted = modules.wire.Credential.deserialize(headers.get(actualHeader));
          assert.equal(modules.wire.Credential.serialize(transmitted), headers.get(actualHeader));
          const payloadRemainder = value => { const payload = structuredClone(value); payload[payee ? "to" : "value"] = null; return hash(JSON.stringify(payload)); };
          const bodySha256 = hash(Buffer.from(await request.clone().arrayBuffer())); request = new Request(request, { headers });
          const challengeBeforeSha256 = hash(JSON.stringify(decoded.challenge)), challengeAfterSha256 = hash(JSON.stringify(transmitted.challenge));
          const payloadRemainderBeforeSha256 = payloadRemainder(decoded.payload), payloadRemainderAfterSha256 = payloadRemainder(transmitted.payload);
          wireEvidence = { field, originalSha256: hash(original), transmittedSha256: hash(headers.get(actualHeader)), originalHeadersSha256, transmittedHeadersSha256: hash(JSON.stringify([...headers])), credentialHeadersSha256: hash(JSON.stringify([headers.get("payment-signature"), headers.get("authorization")])), bodySha256, unchangedBeforeSha256: hash(JSON.stringify([decoded.challenge, payloadRemainderBeforeSha256, decoded.source])), unchangedAfterSha256: hash(JSON.stringify([transmitted.challenge, payloadRemainderAfterSha256, transmitted.source])), envelopeBeforeSha256: challengeBeforeSha256, envelopeAfterSha256: challengeAfterSha256, ...(payee ? { decodedPayeeSha256: hash(transmitted.payload.to) } : { decodedAmountSha256: hash(transmitted.payload.value) }), codecOwner: `mppx@${inventory.find(entry => entry.name === "mppx")?.version}`, decoder: "Credential.deserialize", encoder: "Credential.serialize", challengeBeforeSha256, challengeAfterSha256, payloadRemainderBeforeSha256, payloadRemainderAfterSha256 };
        } else if (mpp && config.mppNetworkMismatchFinal) {
          assert.equal(config.wireCaseId, "credential-offer-chain-mismatch");
          const decoded = modules.wire.Credential.deserialize(original), changed = structuredClone(decoded), headers = new Headers(request.headers);
          assert.equal(decoded.challenge.request.methodDetails.chainId, 84532); assert.match(decoded.source, /^did:pkh:eip155:84532:/);
          let field = "none";
          if (config.wireStage === "negative") { changed.source = changed.source.replace("did:pkh:eip155:84532:", "did:pkh:eip155:8453:"); field = "credential.source"; }
          headers.set(actualHeader, modules.wire.Credential.serialize(changed));
          const transmitted = modules.wire.Credential.deserialize(headers.get(actualHeader));
          assert.equal(modules.wire.Credential.serialize(transmitted), headers.get(actualHeader));
          const bodySha256 = hash(Buffer.from(await request.clone().arrayBuffer())); request = new Request(request, { headers });
          const challengeBeforeSha256 = hash(JSON.stringify(decoded.challenge)), challengeAfterSha256 = hash(JSON.stringify(transmitted.challenge));
          const payloadBeforeSha256 = hash(JSON.stringify(decoded.payload)), payloadAfterSha256 = hash(JSON.stringify(transmitted.payload));
          wireEvidence = { field, originalSha256: hash(original), transmittedSha256: hash(headers.get(actualHeader)), originalHeadersSha256, transmittedHeadersSha256: hash(JSON.stringify([...headers])), credentialHeadersSha256: hash(JSON.stringify([headers.get("payment-signature"), headers.get("authorization")])), bodySha256, unchangedBeforeSha256: hash(JSON.stringify([decoded.challenge, decoded.payload])), unchangedAfterSha256: hash(JSON.stringify([transmitted.challenge, transmitted.payload])), envelopeBeforeSha256: challengeBeforeSha256, envelopeAfterSha256: challengeAfterSha256, decodedSourceNetwork: transmitted.source.split(":").slice(2, 4).join(":"), codecOwner: `mppx@${inventory.find(entry => entry.name === "mppx")?.version}`, decoder: "Credential.deserialize", encoder: "Credential.serialize", challengeBeforeSha256, challengeAfterSha256, payloadBeforeSha256, payloadAfterSha256 };
        } else if (config.temporalValidityFinal) {
          assert.ok(["expired-authorization", "future-authorization", "inverted-validity-window"].includes(config.wireCaseId));
          const decoded = mpp ? modules.wire.Credential.deserialize(original) : modules.wire.decodePaymentSignatureHeader(original), changed = structuredClone(decoded), headers = new Headers(request.headers);
          const authorization = mpp ? changed.payload : changed.payload.authorization;
          assert.ok(lastTypedData && authorization.validAfter !== undefined && authorization.validBefore !== undefined);
          let field = "none";
          if (config.wireStage === "negative") {
            const values = config.wireCaseId === "expired-authorization" ? ["0", "1"] : config.wireCaseId === "future-authorization" ? ["4102444800", "4102444801"] : ["4102444800", "1"];
            [authorization.validAfter, authorization.validBefore] = values; field = "authorization.validity";
            changed.payload.signature = await account.signTypedData({ ...lastTypedData, message: { ...lastTypedData.message, validAfter: BigInt(values[0]), validBefore: BigInt(values[1]) } });
            count.sign++; events.push({ event: "sign", atNs: process.hrtime.bigint().toString() });
          }
          headers.set(actualHeader, mpp ? modules.wire.Credential.serialize(changed) : modules.wire.encodePaymentSignatureHeader(changed));
          const transmitted = mpp ? modules.wire.Credential.deserialize(headers.get(actualHeader)) : modules.wire.decodePaymentSignatureHeader(headers.get(actualHeader));
          const transmittedAuthorization = mpp ? transmitted.payload : transmitted.payload.authorization;
          const mask = value => { const copy = structuredClone(value), target = mpp ? copy.payload : copy.payload.authorization; target.validAfter = null; target.validBefore = null; copy.payload.signature = null; return hash(JSON.stringify(copy)); };
          const bodySha256 = hash(Buffer.from(await request.clone().arrayBuffer())); request = new Request(request, { headers });
          wireEvidence = { field, originalSha256: hash(original), transmittedSha256: hash(headers.get(actualHeader)), originalHeadersSha256, transmittedHeadersSha256: hash(JSON.stringify([...headers])), credentialHeadersSha256: hash(JSON.stringify([headers.get("payment-signature"), headers.get("authorization")])), bodySha256, unchangedBeforeSha256: mask(decoded), unchangedAfterSha256: mask(transmitted), envelopeBeforeSha256: hash(JSON.stringify([mpp ? decoded.challenge : decoded.accepted])), envelopeAfterSha256: hash(JSON.stringify([mpp ? transmitted.challenge : transmitted.accepted])), validAfter: transmittedAuthorization.validAfter, validBefore: transmittedAuthorization.validBefore, codecOwner: mpp ? `mppx@${inventory.find(entry => entry.name === "mppx")?.version}` : `@x402/core@${inventory.find(entry => entry.name === "@x402/core/http")?.version}`, decoder: mpp ? "Credential.deserialize" : "decodePaymentSignatureHeader", encoder: mpp ? "Credential.serialize" : "encodePaymentSignatureHeader" };
        } else {
        const decoded = JSON.parse(Buffer.from(mpp ? original.replace(/^Payment\s+/i, "") : original, "base64url").toString());
        const changed = structuredClone(decoded), headers = new Headers(request.headers), id = config.wireCaseId;
        let field = "none";
        if (config.wireStage === "negative") {
          if (id === "both-credential-headers") {
            headers.set(mpp ? "payment-signature" : "authorization", mpp ? "e30=" : "Payment e30");
            field = "opposite-credential-header";
          } else {
            if (id === "selected-malformed-credential") { changed.payload = null; field = "payload"; }
            else if (id === "credential-offer-chain-mismatch" || id === "credential-offer-asset-mismatch") {
              const offer = mpp ? JSON.parse(Buffer.from(changed.challenge.request, "base64url").toString()) : changed.accepted;
              if (id === "credential-offer-chain-mismatch") {
                if (mpp) offer.methodDetails.chainId = 8453; else offer.network = "eip155:8453";
                field = mpp ? "challenge.request.methodDetails.chainId" : "accepted.network";
              } else { offer[mpp ? "currency" : "asset"] = "0x2222222222222222222222222222222222222222"; field = mpp ? "challenge.request.currency" : "accepted.asset"; }
              if (mpp) changed.challenge.request = Buffer.from(JSON.stringify(offer)).toString("base64url");
            } else {
              const authorization = mpp ? changed.payload : changed.payload.authorization;
              const recipient = id === "credential-offer-recipient-mismatch";
              authorization[recipient ? "to" : "value"] = recipient ? "0x2222222222222222222222222222222222222222" : "10001";
              field = (mpp ? "payload." : "payload.authorization.") + (recipient ? "to" : "value");
            }
            headers.set(actualHeader, mpp ? "Payment " + Buffer.from(JSON.stringify(changed)).toString("base64url") : config.networkMismatchFinal || config.amountMismatchFinal || config.assetMismatchFinal || config.payeeMismatchFinal ? modules.wire.encodePaymentSignatureHeader(changed) : Buffer.from(JSON.stringify(changed)).toString("base64"));
          }
        }
        if (config.networkMismatchFinal || config.amountMismatchFinal || config.assetMismatchFinal || config.payeeMismatchFinal) {
          const decodedNetwork = modules.wire.decodePaymentSignatureHeader(headers.get(actualHeader));
          assert.equal(modules.wire.encodePaymentSignatureHeader(decodedNetwork), headers.get(actualHeader));
        }
        // Compare all unmutated decoded fields, including the original native
        // signature. Echoed challenge mutations never recompute an HMAC/nonce.
        const remainder = value => {
          const masked = structuredClone(value);
          if (id === "selected-malformed-credential") masked.payload = null;
          else if (id === "credential-offer-chain-mismatch" || id === "credential-offer-asset-mismatch") {
            const offer = mpp ? JSON.parse(Buffer.from(masked.challenge.request, "base64url").toString()) : masked.accepted;
            if (id === "credential-offer-chain-mismatch") { if (mpp) offer.methodDetails.chainId = null; else offer.network = null; }
            else offer[mpp ? "currency" : "asset"] = null;
            if (mpp) masked.challenge.request = JSON.stringify(offer);
          } else if (["credential-offer-recipient-mismatch", "credential-offer-amount-mismatch"].includes(id)) (mpp ? masked.payload : masked.payload.authorization)[id === "credential-offer-recipient-mismatch" ? "to" : "value"] = null;
          return hash(JSON.stringify(masked));
        };
        const offerChanged = ["credential-offer-chain-mismatch", "credential-offer-asset-mismatch"].includes(id);
        const envelope = value => hash(JSON.stringify(offerChanged ? value.payload : mpp ? value.challenge : value.accepted));
        const bodySha256 = hash(Buffer.from(await request.clone().arrayBuffer()));
        request = new Request(request, { headers });
        wireEvidence = { field, originalSha256: hash(original), transmittedSha256: hash(headers.get(actualHeader)), originalHeadersSha256, transmittedHeadersSha256: hash(JSON.stringify([...headers])), credentialHeadersSha256: hash(JSON.stringify([headers.get("payment-signature"), headers.get("authorization")])), bodySha256, unchangedBeforeSha256: remainder(decoded), unchangedAfterSha256: remainder(changed), envelopeBeforeSha256: envelope(decoded), envelopeAfterSha256: envelope(changed), ...(config.assetMismatchFinal ? { decodedAssetSha256: hash(modules.wire.decodePaymentSignatureHeader(headers.get(actualHeader)).accepted.asset), codecOwner: `@x402/core@${inventory.find(entry => entry.name === "@x402/core/http")?.version}`, decoder: "decodePaymentSignatureHeader", encoder: "encodePaymentSignatureHeader" } : config.networkMismatchFinal ? { decodedNetwork: modules.wire.decodePaymentSignatureHeader(headers.get(actualHeader)).accepted.network, codecOwner: `@x402/core@${inventory.find(entry => entry.name === "@x402/core/http")?.version}`, decoder: "decodePaymentSignatureHeader", encoder: "encodePaymentSignatureHeader" } : {}) };
        }
      }
      if (config.mppAuthorizationCaseId && config.mppAuthorizationStage === "negative") {
        assert.equal(count.signedSend, 1, "MPP_AUTHORIZATION_FIRST_SIGNED_SEND_ONLY");
        const decoded = JSON.parse(Buffer.from(header.replace(/^Payment\s+/i, ""), "base64url").toString());
        assert.equal(decoded.challenge.intent, "charge"); assert.equal(decoded.challenge.method, "evm"); assert.equal(decoded.payload.type, "authorization");
        decoded.payload.type = "future-authorization";
        const headers = new Headers(request.headers);
        headers.set(actualHeader, "Payment " + Buffer.from(JSON.stringify(decoded)).toString("base64url"));
        request = new Request(request, { headers });
        const owner = `mppx@${inventory.find(entry => entry.name === "mppx")?.version}`; assert.ok(["mppx@0.8.19", "mppx@0.8.17"].includes(owner));
        mppAuthorizationTargetSelection = selectionFromCredential(modules.wire, request.headers.get(actualHeader), owner);
      }
    }
    if (request.url === config.facilitator + "/rpc") count.rpc++;
    const bodySha256 = config.freezeCaseId ? hash(Buffer.from(await request.clone().arrayBuffer())) : null;
    if (config.preflightCaseId && request.url === config.merchant + "/paid" && config.preflightStage !== "negative") preflightRequests.push({ method: request.method, urlSha256: hash(request.url), bodySha256: hash(Buffer.from(await request.clone().arrayBuffer())), headersSha256: hash(JSON.stringify([...request.headers])), credentialSha256: header ? hash(header) : null, signed: Boolean(header) });
    let response;
    if (config.preflightCaseId) {
      const startedAtNs = process.hrtime.bigint().toString(); let errorIdentity = false;
      try { response = await transport(request); }
      catch (error) { errorIdentity = error === bodyFailure; throw error; }
      finally { preflightTransports.push({ startedAtNs, completedAtNs: process.hrtime.bigint().toString(), status: response?.status ?? null, errorIdentity }); }
    } else response = await transport(request);
    if (config.mppAuthorizationOffer && config.offerStage === "negative" && response.status === 402) {
      const owner = `mppx@${inventory.find(entry => entry.name === "mppx")?.version}`; assert.ok(["mppx@0.8.19", "mppx@0.8.17"].includes(owner));
      mppAuthorizationTargetSelection = selectionFromChallenge(modules.wire, response, owner);
    }
    if (config.realmCaseId && response.status === 402) realmOffers.push({ headerSha256: hash(response.headers.get("www-authenticate")), urlSha256: hash(request.url), x402Present: response.headers.has("payment-required") });
    if (config.dualCaseId && response.status === 402) dualOffers.push({ x402Sha256: response.headers.has("payment-required") ? hash(response.headers.get("payment-required")) : null, mppSha256: response.headers.has("www-authenticate") ? hash(response.headers.get("www-authenticate")) : null, urlSha256: hash(request.url) });
    if (config.supportCaseId && response.status === 402) {
      const x402 = response.headers.get("payment-required"), mpp = response.headers.get("www-authenticate");
      if (x402) {
        const wire = config.protocol === "mpp" ? modules.auxiliaryWire : modules.wire;
        assert.equal(wire.decodePaymentRequiredHeader(x402).accepts[0].network, network);
        supportChallenges.push({ protocol: "x402", headerSha256: hash(x402) });
      }
      if (mpp) {
        assert.equal(config.protocol, "mpp");
        const challenge = modules.wire.Challenge.fromResponse(response); assert.equal(challenge.method, "evm"); assert.equal(challenge.intent, "charge");
        nativeChallengeId = challenge.id;
        supportChallenges.push({ protocol: "mpp", headerSha256: hash(mpp), challengeIdSha256: hash(challenge.id) });
      }
    }
    if (config.freezeCaseId) requests.push({ signed: Boolean(header), redirect: request.redirect, status: response.status, credentialSha256: header ? hash(header) : null, protocol: header ? (request.headers.has("payment-signature") ? "x402" : "mpp") : null, network: requestNetwork, bodySha256, method: request.method });
    if (request.url === config.merchant + "/paid") lastStatus = response.status;
    const receiptProtocol = config.dualCaseId ? dualSent.at(-1)?.protocol ?? dualSelected : config.protocol;
    const receiptWire = config.dualCaseId && receiptProtocol !== config.protocol ? modules.auxiliaryWire : modules.wire;
    const receipt = response.headers.get(receiptProtocol === "mpp" ? "payment-receipt" : "payment-response");
    if (config.sellerCaseId) { receiptSha256 = null; receiptValid = false; }
    if (receipt) {
      receiptSha256 = hash(receipt);
      // Observation must not intercept malformed/mismatched receipts before
      // the real buyer sees them. Decoding here never substitutes a verdict.
      try {
        const decoded = receiptProtocol === "mpp" ? receiptWire.Receipt.fromResponse(response) : receiptWire.decodePaymentResponseHeader(receipt);
        receiptFields = Object.keys(decoded).sort();
        receiptValid = receiptProtocol === "mpp" ? decoded.reference === transaction && decoded.status === "success" : decoded.transaction === transaction && decoded.success === true && decoded.network === network;
        assert.equal("paymentId" in decoded, false);
      } catch { receiptValid = false; }
    }
    return response;
  };
  globalThis.fetch = fetch; // Explicit fixture transport for the public RPC verifier.
  let paidFetch;
  if (config.payBuyer) {
    const verification = config.receiptStage === "negative" && config.receiptCaseId.startsWith("audited-verifier-") ? { verifier: async input => {
      assert.equal(input.protocol, config.protocol); assert.equal(input.network, network); assert.equal(input.transaction, transaction);
      assert.equal(input.authorization.from.toLowerCase(), signer.address.toLowerCase());
      assert.equal(count.sign, 1); assert.equal(count.save, 1); assert.equal(count.signedSend, 1);
      const decision = config.receiptCaseId === "audited-verifier-false" ? "false" : "throws";
      verifierCalls.push({ decision, inputSha256: hash(JSON.stringify(input)) });
      if (decision === "throws") throw verifierFailure;
      return false;
    } } : { rpcUrl: config.facilitator + "/rpc" };
    client = modules.pay.createPayClient({ account: signer, network: configuredNetwork, recovery: store, policy: { allowHosts: [new URL(config.merchant).host], maxAmount: config.offerCaseId ? "$0.10" : "$0.01", preference }, verification, fetch });
    paidFetch = url => config.receiptStage === "proof" || config.freezeStage === "resume" || config.replayStage === "resume" || config.step && !["save-before-send-exit", "settle-unknown-capture"].includes(config.step) ? client.resume() : client.fetch(url, config.freezeCaseId === "changed-body-on-resume" ? { method: "POST", body: "freeze-original-body" } : undefined);
  } else if (config.protocol === "mpp") {
    const selection = config.supportCaseId ? { orderChallenges(candidates) {
      assert.ok(nativeChallengeId); const selected = candidates.filter(candidate => candidate.challenge.id === nativeChallengeId); assert.equal(selected.length, 1);
      selectedChallengeSha256 = hash(selected[0].challenge.id);
      return [selected[0], ...candidates.filter(candidate => candidate.challenge.id !== nativeChallengeId)];
    } } : {};
    paidFetch = modules.client.Mppx.create({ methods: [modules.method.charge({ account: signer, currencies: [modules.evm.assets.baseSepolia.USDC], networks: [84532], maxAmount: "0.01" })], fetch, polyfill: false, maxPaymentRetries: 1, ...selection }).fetch;
  } else {
    const client = new modules.client.x402Client().register(network, new modules.evm.ExactEvmScheme(signer));
    paidFetch = modules.fetch.wrapFetchWithPayment(fetch, client);
  }
  send({ type: "ready", port: 0 });
  if (config.mppAuthorizationCaseId) {
    wrapperCalls++;
    const response = await paidFetch(config.merchant + "/paid"), responseText = await response.text();
    const negative = config.mppAuthorizationStage === "negative";
    assert.equal(response.status, negative ? 402 : 200);
    let classification;
    if (negative) { assert.equal(JSON.parse(responseText).type, "https://paymentauth.org/problems/invalid-payload"); classification = "invalid-payload"; }
    else { assert.equal(responseText, "paid"); classification = "paid"; }
    send({ type: "mpp-authorization-result", caseId: config.mppAuthorizationCaseId, stage: config.mppAuthorizationStage, counters: count, events, status: response.status, classification, responseSha256: hash(responseText), challenge: response.headers.has("www-authenticate"), receiptSha256, receiptValid, wrapperCalls, targetSelection: mppAuthorizationTargetSelection ?? null, actualSelection: mppAuthorizationActualSelection ?? null });
  } else if (config.authorizationCaseId) {
    wrapperCalls++;
    let response;
    if (config.authorizationStage === "negative") {
      const offered = await fetch(config.merchant + "/paid");
      assert.equal(offered.status, 402);
      const required = modules.wire.decodePaymentRequiredHeader(offered.headers.get("payment-required"));
      assert.equal(required.x402Version, 2); assert.equal(required.accepts.length, 1);
      const accepted = structuredClone(required.accepts[0]), id = config.authorizationCaseId;
      if (id === "upto") { accepted.scheme = "upto"; authorizationTargetSelector = { field: "accepts.scheme", valueSha256: hash("upto"), owner: authorizationOwner }; }
      else {
        const value = id === "permit2" ? "permit2" : "future-transfer";
        accepted.extra = { ...accepted.extra, assetTransferMethod: value };
        authorizationTargetSelector = { field: "accepts.extra.assetTransferMethod", valueSha256: hash(value), owner: authorizationOwner };
      }
      // Use the official wire encoder with inert signature-shaped bytes. The
      // required authorization selector must be rejected before verification;
      // no signer callback is involved in this credential-path control.
      const encoded = modules.wire.encodePaymentSignatureHeader({ x402Version: required.x402Version, resource: required.resource, accepted, payload: { signature: "0x" + "00".repeat(65), authorization: { from: account.address, to: accepted.payTo, value: accepted.amount, validAfter: "0", validBefore: "4102444800", nonce: "0x" + "11".repeat(32) } } });
      response = await fetch(config.merchant + "/paid", { headers: { "PAYMENT-SIGNATURE": encoded } });
    } else {
      response = await paidFetch(config.merchant + "/paid");
    }
    const responseText = await response.text(), negative = config.authorizationStage === "negative";
    assert.equal(response.status, negative ? 402 : 200);
    if (negative) assert.equal(modules.wire.decodePaymentRequiredHeader(response.headers.get("payment-required")).error, "No matching payment requirements");
    else assert.equal(responseText, "paid");
    assert.ok(authorizationActualSelector);
    send({ type: "authorization-result", caseId: config.authorizationCaseId, stage: config.authorizationStage, counters: count, events, status: response.status, classification: negative ? "no-matching-requirements" : "paid", responseSha256: hash(responseText), challenge: response.headers.has("payment-required"), receiptSha256, receiptValid, wrapperCalls, targetSelector: authorizationTargetSelector ?? null, actualSelector: authorizationActualSelector });
  } else if (config.wireDecoderCaseId) {
    wrapperCalls++;
    const response = await paidFetch(config.merchant + "/paid"), responseText = await response.text();
    let classification;
    if (response.status === 200) { assert.equal(responseText, "paid"); classification = "paid"; }
    else {
      assert.equal(response.status, 402);
      if (config.protocol === "mpp") { assert.equal(JSON.parse(responseText).type, "https://paymentauth.org/problems/malformed-credential"); classification = "malformed-credential"; }
      else { assert.equal(modules.wire.decodePaymentRequiredHeader(response.headers.get("payment-required")).error, "Payment required"); classification = "payment-required"; }
    }
    send({ type: "wire-decoder-result", caseId: config.wireDecoderCaseId, stage: config.wireDecoderStage, counters: count, events, status: response.status, classification, responseSha256: hash(responseText), challenge: response.headers.has(config.protocol === "mpp" ? "www-authenticate" : "payment-required"), receiptSha256, receiptValid, wrapperCalls, wire: wireEvidence });
  } else if (config.wireCaseId) {
    wrapperCalls++;
    const response = await paidFetch(config.merchant + "/paid"), responseText = await response.text();
    let classification;
    if (response.status === 200) { assert.equal(responseText, "paid"); classification = "paid"; }
    else if (response.status === 400) {
      const value = JSON.parse(responseText); assert.deepEqual(Object.keys(value).sort(), ["errorCode", "retryable"]); assert.equal(value.retryable, false);
      assert.ok(["AMBIGUOUS_PAYMENT_CREDENTIAL", "PAYMENT_CREDENTIAL_INVALID"].includes(value.errorCode)); classification = value.errorCode;
    } else if (config.protocol === "mpp") {
      const value = JSON.parse(responseText);
      classification = { "https://paymentauth.org/problems/malformed-credential": "malformed-credential", "https://paymentauth.org/problems/invalid-challenge": "invalid-challenge", "https://paymentauth.org/problems/verification-failed": "verification-failed" }[value.type];
      assert.ok(classification, "CLOSED_MPP_WIRE_CLASSIFICATION");
    } else {
      const value = modules.wire.decodePaymentRequiredHeader(response.headers.get("payment-required"));
      if (config.temporalValidityFinal) { assert.equal(value.x402Version, 2); classification = "temporal-rejected"; }
      else { assert.equal(value.error, "No matching payment requirements"); classification = "no-matching-requirements"; }
    }
    if (config.mppNetworkMismatchFinal) {
      const negative = config.wireStage === "negative";
      if (wireEvidence.challengeBeforeSha256 !== wireEvidence.challengeAfterSha256) throw new Error("MPP_FINAL_CHALLENGE_CHANGED");
      if (wireEvidence.payloadBeforeSha256 !== wireEvidence.payloadAfterSha256) throw new Error("MPP_FINAL_PAYLOAD_CHANGED");
      if (wireEvidence.decodedSourceNetwork !== (negative ? "eip155:8453" : "eip155:84532")) throw new Error("MPP_FINAL_SOURCE_MISMATCH");
      if (response.headers.has("www-authenticate") !== negative) throw new Error("MPP_FINAL_RESPONSE_CHALLENGE_MISMATCH");
      if (classification !== (negative ? "verification-failed" : "paid")) throw new Error("MPP_FINAL_CLASSIFICATION_MISMATCH");
    }
    send({ type: "wire-result", caseId: config.wireCaseId, stage: config.wireStage, counters: count, events, status: response.status, classification, responseSha256: hash(responseText), challenge: response.headers.has(config.protocol === "mpp" ? "www-authenticate" : "payment-required"), receiptSha256, receiptValid, wrapperCalls, wire: wireEvidence });
  } else if (config.realmCaseId) {
    let outcome = null;
    try { const response = await client.fetch(config.merchant + "/paid"); assert.equal(await response.text(), "paid"); }
    catch (error) { outcome = { code: error.code, phase: error.phase, retryable: error.retryable }; }
    send({ type: "realm-result", profile: config.realmProfile, preference, counters: count, events, status: lastStatus, error: outcome, pending: Boolean(await client.pending()), saveAttempts, clearAttempts, saved: realmSaved ?? null, offers: realmOffers, sent: realmSent, receiptSha256, receiptValid });
  } else if (config.dualCaseId) {
    let outcome = null;
    try { const response = await client.fetch(config.merchant + "/paid"); assert.equal(await response.text(), "paid"); }
    catch (error) { if (!duplicateCase || config.dualStage !== "negative") throw error; outcome = { code: error.code, phase: error.phase, retryable: error.retryable }; }
    send({ type: "dual-result", caseId: config.dualCaseId, stage: config.dualStage, preference, counters: count, events, status: lastStatus, error: outcome, pending: Boolean(await client.pending()), saveAttempts, clearAttempts, selectedProtocol: dualSent.at(-1)?.protocol ?? null, saved: dualSaved ?? null, offers: dualOffers, sent: dualSent, receiptSha256, receiptValid, receiptOwner: dualSent.length ? dualSent.at(-1).protocol === config.protocol ? "selected" : "auxiliary" : null });
  } else if (config.preflightCaseId === "pending-open-other-network") {
    let outcome = null, pending = null, pendingError = null;
    try { const response = config.preflightStage === "capture" ? await client.fetch(config.merchant + "/paid") : await client.resume(); lastStatus = response.status; assert.equal(await response.text(), "paid"); }
    catch (error) { outcome = { code: error.code, phase: error.phase, retryable: error.retryable }; }
    try { pending = Boolean(await client.pending()); }
    catch (error) { pendingError = { code: error.code, phase: error.phase, retryable: error.retryable }; }
    send({ type: "preflight-result", caseId: config.preflightCaseId, stage: config.preflightStage, network: configuredNetwork, counters: count, events, status: lastStatus, error: outcome, pending, pendingError, saveAttempts, clearAttempts, credentialSha256: credentialSha256 ?? null, recordSha256: recordSha256 ?? null, receiptSha256, receiptValid, input: null, transports: preflightTransports, requests: preflightRequests });
  } else if (config.preflightCaseId) {
    const input = { method: "POST", bodyUsedBeforeCall: false, bodyLockedBeforeCall: false, bodySha256: null, createdAtNs: process.hrtime.bigint().toString(), callAtNs: null, completedAtNs: null, pullCount: 0, failedAtNs: null };
    const failing = config.preflightStage === "negative" && config.preflightCaseId === "request-body-read-failure";
    const body = failing ? new ReadableStream({ pull(controller) { input.pullCount++; input.failedAtNs = process.hrtime.bigint().toString(); controller.error(bodyFailure); } }) : "preflight-original-body";
    const request = new Request(config.merchant + "/paid", { method: "POST", body, duplex: "half" });
    if (!failing) input.bodySha256 = hash("preflight-original-body");
    if (config.preflightStage === "negative" && config.preflightCaseId === "body-not-replayable") await request.arrayBuffer();
    input.bodyUsedBeforeCall = request.bodyUsed; input.bodyLockedBeforeCall = request.body.locked;
    input.callAtNs = process.hrtime.bigint().toString(); let outcome = null;
    try { const response = await client.fetch(request); lastStatus = response.status; assert.equal(await response.text(), "paid"); }
    catch (error) { outcome = { code: error.code, phase: error.phase, retryable: error.retryable }; }
    input.completedAtNs = process.hrtime.bigint().toString();
    const pending = Boolean(await client.pending());
    send({ type: "preflight-result", caseId: config.preflightCaseId, stage: config.preflightStage, network, counters: count, events, status: lastStatus, error: outcome, pending, pendingError: null, saveAttempts, clearAttempts, credentialSha256: credentialSha256 ?? null, recordSha256: recordSha256 ?? null, receiptSha256, receiptValid, input, transports: preflightTransports, requests: preflightRequests });
  } else if (config.supportCaseId) {
    wrapperCalls++;
    const response = await paidFetch(config.merchant + "/paid"), text = await response.text();
    let error = null;
    if (response.status === 502) { const value = JSON.parse(text); assert.deepEqual(Object.keys(value).sort(), ["errorCode", "retryable"]); error = { code: value.errorCode, retryable: value.retryable }; }
    else assert.equal(text, "paid");
    if (response.status === 502) for (const name of ["payment-required", "www-authenticate", "payment-response", "payment-receipt"]) assert.equal(response.headers.has(name), false);
    send({ type: "support-buyer-result", caseId: config.supportCaseId, stage: config.supportStage, counters: count, events, status: response.status, error, retryAfter: response.headers.get("retry-after"), receiptSha256, receiptValid, wrapperCalls, challenges: supportChallenges, signedProtocols, selectedChallengeSha256 });
  } else if (config.replayCaseId && ["same-process-replay", "fresh-process-replay"].includes(config.replayCaseId)) {
    const execute = async stage => {
      let status = null, errorCode = null;
      try { const response = stage === "replay" ? await client.resume() : await paidFetch(config.merchant + "/paid"); status = response.status; assert.equal(await response.text(), "paid"); }
      catch (error) { errorCode = error.code; }
      const pending = Boolean(await client.pending());
      send({ type: "replay-result", caseId: config.replayCaseId, stage, counters: count, events, status, errorCode, pending, credentialSha256, recordSha256, receiptSha256, receiptValid });
    };
    if (config.replayStage === "initial") {
      await execute("first");
      if (config.replayCaseId === "same-process-replay") { assert.deepEqual(await receive(), { type: "replay-proceed", caseId: config.replayCaseId }); await execute("replay"); }
    } else await execute("replay");
  } else if (config.sellerCaseId) {
    for (const stage of config.sellerCaseId === "handler-200" ? ["first"] : ["first", "retry"]) {
      if (stage === "retry") assert.deepEqual(await receive(), { type: "seller-retry", caseId: config.sellerCaseId });
      // Native MPP prepareInitialRequest mutates its init.headers. Never reuse
      // that unsigned init over the captured signed Request on application retry.
      const init = config.sellerCaseId === "handler-302" ? { redirect: "manual" } : undefined;
      const response = stage === "first" ? (wrapperCalls++, await paidFetch(config.merchant + "/paid", init)) : await fetch(capturedRequest.clone(), init);
      const text = await response.text(); assert.equal(text.includes("SYNTHETIC_HANDLER_SECRET"), false);
      let error = null;
      if (config.settleUnknownFinal) {
        assert.equal(response.status, 503); const value = JSON.parse(text);
        if (Object.hasOwn(value, "details")) { assert.equal(value.status, 503); assert.deepEqual(value.details, { errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true }); }
        else assert.deepEqual(value, { errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true });
        send({ type: "seller-result", caseId: config.sellerCaseId, stage, counters: count, events, status: response.status, error: null, retryAfter: response.headers.get("retry-after"), receiptSha256, receiptValid, wrapperCalls, requests: sellerRequests });
        continue;
      } else if (config.verifySettleRejectionFinal) {
        if (config.verifySettleRejectionCaseId === "command-failed-result") {
          assert.equal(response.status, 402); assert.equal(response.headers.has("www-authenticate"), true); assert.equal(/SYNTHETIC|private/i.test(text), false);
          send({ type: "seller-result", caseId: config.sellerCaseId, stage, counters: count, events, status: response.status, error: null, retryAfter: null, receiptSha256, receiptValid, wrapperCalls, requests: sellerRequests });
          continue;
        }
        assert.equal(response.status, 403); const value = JSON.parse(text);
        if (Object.hasOwn(value, "details")) {
          assert.deepEqual(Object.keys(value).sort(), ["detail", "details", "status", "title", "type"]);
          assert.deepEqual(Object.keys(value.details).sort(), ["errorCode", "retryable"]);
          assert.equal(value.status, 403); error = { code: value.details.errorCode, retryable: value.details.retryable };
        } else {
          assert.deepEqual(Object.keys(value).sort(), ["errorCode", "retryable"]); error = { code: value.errorCode, retryable: value.retryable };
        }
        assert.deepEqual(error, { code: "PAYMENT_AUTH_FORBIDDEN", retryable: false });
        // The closed seller-result IPC records the public status and counters;
        // the private error body was validated above and is not forwarded.
        error = null;
      } else if (response.headers.get("content-type")?.includes("application/json")) {
        const value = JSON.parse(text); assert.deepEqual(Object.keys(value).sort(), ["errorCode", "retryable"]);
        error = { code: value.errorCode, retryable: value.retryable };
      } else assert.equal(text, "paid");
      send({ type: "seller-result", caseId: config.sellerCaseId, stage, counters: count, events, status: response.status, error, retryAfter: response.headers.get("retry-after"), receiptSha256, receiptValid, wrapperCalls, requests: sellerRequests, ...(config.standardWireReceiptFinal ? { receiptFields } : {}) });
    }
  } else if (config.offerCaseId) {
    let outcome = null;
    try { const response = await paidFetch(config.merchant + "/paid"); lastStatus = response.status; assert.equal(await response.text(), "paid"); }
    catch (error) { outcome = { code: error.code, phase: error.phase, retryable: error.retryable }; }
    const pending = Boolean(await client.pending());
    send({ type: "offer-result", caseId: config.offerCaseId, counters: count, events, status: lastStatus, error: outcome, pending, credentialSha256: credentialSha256 ?? null, recordSha256: recordSha256 ?? null, saveAttempts, clearAttempts, receiptSha256, receiptValid, ...(config.authorizationOffer ? { authorizationOffer: true, stage: config.offerStage, targetSelector: authorizationTargetSelector ?? null, actualSelector: authorizationActualSelector ?? null } : {}), ...(config.mppAuthorizationOffer ? { mppAuthorizationOffer: true, stage: config.offerStage, targetSelection: mppAuthorizationTargetSelection ?? null, actualSelection: mppAuthorizationActualSelection ?? null } : {}) });
  } else if (config.receiptCaseId) {
    let outcome = null;
    try { const response = await paidFetch(config.merchant + "/paid"); lastStatus = response.status; assert.equal(await response.text(), "paid"); }
    catch (error) {
      if (config.receiptStage === "negative" && config.receiptCaseId === "audited-verifier-throws") assert.equal(error.cause, verifierFailure);
      outcome = { code: error.code, phase: error.phase, retryable: error.retryable };
    }
    const pending = Boolean(await client.pending());
    send({ type: "receipt-result", caseId: config.receiptCaseId, counters: count, events, status: lastStatus, error: outcome, pending, credentialSha256, recordSha256, sentCiphertextSha256, clearAttempts, receiptSha256, receiptValid, verifierCalls });
  } else if (config.freezeCaseId) {
    let errorCode = null, pending = null, pendingError = null;
    const errorCodes = ["PENDING_PAYMENT_VERSION_UNSUPPORTED", "PENDING_PAYMENT_CORRUPT", "PAYMENT_POLICY_DENIED", "PAYMENT_SERVICE_UNAVAILABLE", "PAYMENT_STATUS_UNKNOWN", "PAYMENT_CHALLENGE_INVALID"];
    try { const response = await paidFetch(config.merchant + "/paid"); lastStatus = response.status; await response.arrayBuffer(); }
    catch (error) { assert.ok(errorCodes.includes(error.code), "UNEXPECTED_FREEZE_ERROR"); errorCode = error.code; }
    try { pending = Boolean(await client.pending()); }
    catch (error) { assert.ok(errorCodes.includes(error.code), "UNEXPECTED_PENDING_ERROR"); pendingError = error.code; }
    send({ type: "freeze-result", caseId: config.freezeCaseId, counters: count, events, status: lastStatus, errorCode, pending, pendingError, credentialSha256: credentialSha256 ?? null, recordSha256: recordSha256 ?? null, requests });
  } else if (config.caseId) {
    const firstCall = await observeCall(() => paidFetch(config.merchant + "/paid"));
    const pending = Boolean(await client.pending());
    send({ type: "claim-result", caseId: config.caseId, counters: count, events, saveAttempts, saveOutcome, storageError, candidateCredentialSha256, candidateRecordSha256, calls: [firstCall, ...(competingCall ? [competingCall] : [])], pending, status: lastStatus, receiptSha256, receiptValid });
  } else {
  if (config.step && !["save-before-send-exit", "settle-unknown-capture"].includes(config.step)) {
    const pending = await client.pending();
    assert.equal(pending.network, network); assert.equal(pending.protocol, config.protocol);
  }
  let response, errorCode = null;
  try { response = await paidFetch(config.merchant + "/paid"); }
  catch (error) { if (!config.step) throw error; errorCode = error.code; }
  const pending = client ? Boolean(await client.pending()) : false;
  if (!config.step || ["proof", "verified-resume"].includes(config.step)) {
    assert.equal(errorCode, null); assert.equal(response.status, 200); assert.equal(await response.text(), "paid"); assert.equal(pending, false);
  } else {
    assert.equal(pending, true);
    assert.equal(count.clear, 0);
    const stable = { unknown: "PAYMENT_STATUS_UNKNOWN", "accepted-503": "PAYMENT_STATUS_UNKNOWN", "signed-500": "PAYMENT_STATUS_UNKNOWN", "signed-502": "PAYMENT_STATUS_UNKNOWN", "signed-599": "PAYMENT_STATUS_UNKNOWN", missing: "PAYMENT_RECEIPT_MISSING", malformed: "PAYMENT_SERVICE_UNAVAILABLE", mismatch: "PAYMENT_RECEIPT_MISMATCH", "rpc-unavailable": "PAYMENT_RECEIPT_UNVERIFIED", "rpc-mismatch": "PAYMENT_RECEIPT_MISMATCH" }[config.step];
    if (stable) assert.equal(errorCode, stable);
    if (["disconnect", "timeout", "accepted-disconnect", "accepted-timeout"].includes(config.step)) assert.ok(["PAYMENT_STATUS_UNKNOWN", "PAYMENT_SERVICE_UNAVAILABLE"].includes(errorCode));
  }
  send({ type: "completed", counters: count, events, status: lastStatus, credentialSha256, receiptSha256, receiptValid, ...(recordSha256 ? { recordSha256 } : {}), ...(config.step ? { pending, errorCode } : {}) });
  }
  process.disconnect();
} catch (error) {
  const codes = ["PAYMENT_CHALLENGE_INVALID", "PAYMENT_STATUS_UNKNOWN", "PAYMENT_RECEIPT_MISSING", "PAYMENT_RECEIPT_MISMATCH", "PAYMENT_RECEIPT_UNVERIFIED", "PAYMENT_SERVICE_UNAVAILABLE", "PAYMENT_POLICY_DENIED", "PAYMENT_SIGNING_FAILED"];
  send({ type: "failure", messageSha256: hash(String(error?.message)), code: codes.includes(error?.code) ? error.code : "UNCLASSIFIED", counters: count, lastStatus }); process.exitCode = 1;
  if (process.connected) process.disconnect();
}
