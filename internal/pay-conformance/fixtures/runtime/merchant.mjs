import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { boot, certificates, body, listen, serveControl, respond, send, counters, tlsFetch, hash, network, organizationId, requirements, paymentId } from "./common.mjs";
import { makeServer } from "../../../../packages/pay/scripts/x402-boundary-runtime.mjs";

try {
  const { config, modules, inventory } = await boot(async (config, load) => {
    const auxiliary = ["opposite-challenge-after-signature", "other-protocol-shaped-nonce", "coincident-fields"].includes(config.freezeCaseId) ? { oppositePay: await load(config.pay, "@0xkey-io/pay/server"), oppositeWire: await load(config.pay, config.protocol === "x402" ? "mppx" : "@x402/core/http"), oppositeOwner: await load(config.pay, config.protocol === "x402" ? "mppx/server" : "@x402/core/server") } : {};
    if (config.dualCaseId && config.dualCaseId !== "duplicate-incompatible-offers") auxiliary.dual = config.protocol === "x402" ? { pay: await load(config.pay, "@0xkey-io/pay/mpp"), core: await load(config.pay, "mppx/server"), wire: await load(config.pay, "mppx") } : { pay: await load(config.pay, "@0xkey-io/pay/x402"), core: await load(config.pay, "@x402/core/server"), evm: await load(config.pay, "@x402/evm/exact/server"), wire: await load(config.pay, "@x402/core/http") };
    if (!config.payBuyer) return { pay: await load(config.pay, "@0xkey-io/pay/server"), ...config.supportCaseId?.startsWith("S-supported-") ? { supportOwner: await load(config.pay, "@x402/core/server") } : {} };
    if (config.protocol === "mpp") return { ...auxiliary, pay: await load(config.pay, "@0xkey-io/pay/mpp"), core: await load(config.native, "mppx/server"), wire: await load(config.native, "mppx") };
    return { ...auxiliary, pay: await load(config.pay, "@0xkey-io/pay/x402"), core: await load(config.native, "@x402/core/server"), evm: await load(config.native, "@x402/evm/exact/server"), wire: await load(config.native, "@x402/core/http") };
  });
  const count = counters(), failures = [], events = [], effects = new Set(), received = [], dependencyErrors = [];
  const offers = [], requestBodies = []; let redirectTargets = 0;
  const businessArrivals = [];
  const wireArrivals = [];
  const realmOffers = [], realmArrivals = [];
  const dualOffers = [], dualArrivals = [], protocolCounters = { x402: counters(), mpp: counters() };
  const duplicateCase = config.dualCaseId === "duplicate-incompatible-offers";
  let duplicate = null, duplicateHeaders;
  const receiptChanges = [], offerChanges = [];
  const handlerObservations = [], successfulSettlements = [], fulfillmentObservations = [], supportTransports = [];
  const tls = await certificates(config.certificates), transport = tlsFetch(tls.ca, new Set([config.facilitator]));
  const fetch = async (input, init) => {
    const fulfillment = config.sellerCaseId && new URL(typeof input === "string" ? input : input.url).pathname.endsWith("/fulfillment");
    const supported = config.supportCaseId && new URL(typeof input === "string" ? input : input.url).pathname === "/supported";
    const startedAtNs = process.hrtime.bigint().toString();
    let response, transportError = null;
    try { response = await transport(input, init); }
    catch (error) { transportError = error.code; throw error; }
    finally {
      if (fulfillment) fulfillmentObservations.push({ startedAtNs, completedAtNs: process.hrtime.bigint().toString(), responseStatus: response?.status ?? null, acknowledged: response?.status === 200, transportError });
      if (supported) supportTransports.push({ startedAtNs, completedAtNs: process.hrtime.bigint().toString(), responseStatus: response?.status ?? null, transportError });
    }
    if (config.sellerCaseId && response.status === 200 && new URL(typeof input === "string" ? input : input.url).pathname.endsWith("/v1/settlements/charge")) {
      const value = await response.clone().json(); assert.equal(value.settlement.success, true); assert.equal(value.paymentId, paymentId);
      successfulSettlements.push({ paymentIdSha256: hash(value.paymentId), atNs: process.hrtime.bigint().toString() });
    }
    return response;
  };
  const ec = createECDH("prime256v1"); ec.generateKeys();
  const options = { network, organizationId, payTo: requirements.payTo, facilitatorUrl: config.facilitator, fetch, apiKey: { publicKey: ec.getPublicKey("hex", "compressed"), privateKey: ec.getPrivateKey("hex").padStart(64, "0") } };
  const application = key => {
    count.handler++; events.push({ event: "handler", atNs: process.hrtime.bigint().toString() });
    if (!effects.has(key)) { effects.add(key); count.applicationEffect++; }
    return new Response("paid", { headers: { "Content-Type": "text/plain" } });
  };
  let route, step;
  const preflightBody = config.preflightCaseId && config.preflightCaseId !== "pending-open-other-network";
  const methodName = config.freezeCaseId === "changed-body-on-resume" || preflightBody ? "POST" : "GET";
  const oppositeProtocol = config.protocol === "x402" ? "mpp" : "x402";
  const oppositeServerRoute = modules.oppositePay?.createPayServer({ ...options, protocols: [oppositeProtocol], ...(oppositeProtocol === "mpp" ? { mppSecretKey: randomBytes(32).toString("hex") } : { facilitatorUrl: config.facilitator + "/base-sepolia" }) }).protect({ price: "$0.01" }, () => { throw new Error("OPPOSITE_HANDLER_FORBIDDEN"); });
  const oppositeRoute = !oppositeServerRoute ? null : oppositeProtocol === "mpp" ? oppositeServerRoute : async request => new Response(null, { status: 402, headers: { "Payment-Required": modules.oppositeWire.encodePaymentRequiredHeader({ x402Version: 2, resource: { url: request.url, description: "protocol-freeze", mimeType: "text/plain" }, accepts: [requirements] }) } });
  if (config.dualCaseId) {
    const routes = {}, wires = {};
    for (const [protocol, priceProfile] of duplicateCase ? [[config.protocol, "standard"], [config.protocol, "duplicate-second"]] : [["x402", "standard"], ["mpp", "standard"]]) {
      const owner = protocol === config.protocol ? modules : modules.dual;
      wires[protocol] = owner.wire;
      const nativeOptions = { ...options, facilitatorUrl: config.facilitator + "/dual-" + protocol };
      const paid = request => {
        assert.equal(priceProfile, "standard", "PRICE_ALTERNATIVE_PAYMENT_FORBIDDEN");
        const before = count.applicationEffect;
        const response = application(hash(request.headers.get(protocol === "mpp" ? "authorization" : "payment-signature")));
        protocolCounters[protocol].handler++; protocolCounters[protocol].applicationEffect += count.applicationEffect - before;
        return response;
      };
      if (protocol === "mpp") {
        const method = owner.pay.create0xkeyEvmChargeMethod({ ...nativeOptions, paymentError: owner.wire.Errors.PaymentError });
        const charge = owner.core.Mppx.create({ methods: [method], secretKey: randomBytes(32).toString("hex") }).evm.charge({ amount: priceProfile === "standard" ? "0.01" : "0.005" });
        routes[priceProfile === "standard" ? protocol : "alternative"] = async request => { assert.equal(priceProfile === "duplicate-second" && request.headers.has("authorization"), false); const result = await charge(request); return result.status === 402 ? result.challenge : result.withReceipt(paid(request)); };
      } else {
        const client = owner.pay.create0xkeyFacilitatorClient({ ...nativeOptions, facilitatorResponseError: owner.core.FacilitatorResponseError });
        const http = makeServer(owner.core, owner.evm, client, "/paid", "GET", priceProfile); await http.initialize();
        routes[priceProfile === "standard" ? protocol : "alternative"] = async request => {
          assert.equal(priceProfile === "duplicate-second" && request.headers.has("payment-signature"), false);
          const url = new URL(request.url), adapter = { getHeader: name => request.headers.get(name) ?? undefined, getMethod: () => request.method, getPath: () => url.pathname, getUrl: () => url.href, getAcceptHeader: () => request.headers.get("accept") ?? "", getUserAgent: () => "pay-conformance" };
          const context = { adapter, path: url.pathname, method: request.method, paymentHeader: request.headers.get("payment-signature") ?? undefined };
          const result = await http.processHTTPRequest(context);
          if (result.type === "payment-error") return new Response(result.response.body === undefined ? null : JSON.stringify(result.response.body), { status: result.response.status, headers: result.response.headers });
          assert.equal(result.type, "payment-verified"); const response = paid(request);
          const settlement = await http.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions, { request: context }, undefined, result.beforeHandlerSettlement);
          assert.equal(settlement.success, true);
          return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...settlement.headers } });
        };
      }
    }
    route = async request => {
      const x402 = request.headers.has("payment-signature"), mpp = request.headers.has("authorization");
      assert.equal(x402 && mpp, false, "DUAL_CREDENTIALS_FORBIDDEN");
      if (x402 || mpp) return routes[x402 ? "x402" : "mpp"](request);
      const headers = new Headers(), components = [];
      for (const [protocol, priceProfile] of duplicateCase ? step === "proof" ? [[config.protocol, "standard"]] : [[config.protocol, "standard"], [config.protocol, "duplicate-second"]] : [["x402", "standard"], ["mpp", "standard"]]) {
        const result = await routes[priceProfile === "standard" ? protocol : "alternative"](request.clone()); assert.equal(result.status, 402);
        const name = protocol === "mpp" ? "www-authenticate" : "payment-required", value = result.headers.get(name); assert.ok(value);
        const decoded = protocol === "mpp" ? wires.mpp.Challenge.fromResponse(result) : wires.x402.decodePaymentRequiredHeader(value);
        const offer = protocol === "mpp" ? decoded.request : decoded.accepts[0];
        if (protocol === "mpp") { assert.equal(decoded.method, "evm"); assert.equal(decoded.intent, "charge"); }
        else { assert.equal(decoded.resource.url, request.url); assert.equal(offer.network, network); }
        assert.equal(offer.amount, priceProfile === "standard" ? "10000" : "5000"); assert.equal((offer.currency ?? offer.asset).toLowerCase(), requirements.asset.toLowerCase());
        assert.equal((offer.recipient ?? offer.payTo).toLowerCase(), requirements.payTo);
        if (protocol === "mpp") assert.equal(offer.methodDetails.chainId, 84532);
        const economicSha256 = hash(JSON.stringify([network, requirements.asset, requirements.payTo, offer.amount]));
        dualOffers.push({ protocol, owner: protocol === config.protocol ? "selected" : "auxiliary", priceProfile, urlSha256: hash(request.url), headerSha256: hash(value), decodedSha256: hash(JSON.stringify(decoded)), amount: offer.amount, network, economicSha256 });
        components.push(value);
        headers.set(name, value);
      }
      if (duplicateCase && step !== "proof") {
        const [first, second] = components; assert.notEqual(first, second);
        if (config.protocol === "x402") {
          duplicateHeaders = [first, second];
          duplicate = { protocol: "x402", firstSha256: hash(first), secondSha256: hash(second), coalescedSha256: hash(first + ", " + second), envelopeBeforeSha256: hash(request.url), envelopeAfterSha256: hash(request.url) };
        } else {
          const encoded = value => { const matches = [...value.matchAll(/(?:^|,\s*)request="([^"]+)"/g)]; assert.equal(matches.length, 1); return matches[0][1]; };
          const firstRequest = encoded(first), secondRequest = encoded(second); assert.notEqual(firstRequest, secondRequest);
          const appended = ', request="' + secondRequest + '"', changed = first + appended;
          const envelope = value => value.replace(/(request=")[^"]+(")/, "$1$2");
          duplicate = { protocol: "mpp", firstSha256: hash(firstRequest), secondSha256: hash(secondRequest), coalescedSha256: hash(changed), envelopeBeforeSha256: hash(envelope(first)), envelopeAfterSha256: hash(envelope(changed.slice(0, -appended.length))) };
          headers.set("www-authenticate", changed);
        }
      }
      return new Response(null, { status: 402, headers });
    };
  } else if (!config.payBuyer) {
    const defaultDual = config.supportCaseId && config.protocol === "mpp" && config.supportCaseId !== "S-mpp-only-nondependency-positive";
    route = modules.pay.createPayServer({ ...options, ...defaultDual ? {} : { protocols: [config.protocol] }, ...(config.protocol === "mpp" ? { mppSecretKey: randomBytes(32).toString("hex") } : {}) }).protect({ price: "$0.01" }, context => {
      assert.equal(context.paymentId, paymentId);
      if (!config.sellerCaseId) return application(context.paymentId);
      assert.equal(successfulSettlements.length, count.handler + 1, "SETTLEMENT_SUCCESS_BEFORE_EACH_HANDLER");
      const settlement = successfulSettlements.at(-1); assert.equal(settlement.paymentIdSha256, hash(context.paymentId));
      const response = application(context.paymentId);
      const throws = step !== "proof" && ["handler-throws", "fulfillment-failed-after-handler-failure"].includes(config.sellerCaseId);
      const status = step === "proof" || config.sellerCaseId.startsWith("fulfillment-") ? 200 : { "handler-500": 500, "handler-400": 400, "handler-404": 404, "handler-302": 302, "handler-200": 200 }[config.sellerCaseId];
      const receiptInjected = !throws && status !== 200 && config.protocol === "mpp";
      handlerObservations.push({ protocol: context.protocol, paymentIdSha256: hash(context.paymentId), settlementAtNs: settlement.atNs, atNs: events.at(-1).atNs, responseStatus: throws ? null : status, receiptInjected });
      if (throws) throw new Error("SYNTHETIC_HANDLER_SECRET");
      const headers = new Headers(response.headers);
      if (receiptInjected) headers.set("Payment-Receipt", "SYNTHETIC_HANDLER_RECEIPT");
      if (status === 302) headers.set("Location", new URL("/redirect-target", context.request.url).href);
      return new Response(response.body, { status, headers });
    });
  } else if (config.protocol === "mpp") {
    const method = modules.pay.create0xkeyEvmChargeMethod({ ...options, paymentError: modules.wire.Errors.PaymentError });
    const charge = modules.core.Mppx.create({ methods: [method], secretKey: randomBytes(32).toString("hex"), ...config.billingRecovery ? { realm: "billing" } : ["x402", "billing"].includes(config.realmProfile) ? { realm: config.realmProfile } : {} }).evm.charge({ amount: "0.01" });
    route = async request => {
      const result = await charge(request);
      if (result.status === 402) {
        if (config.realmCaseId) {
          const challenge = modules.wire.Challenge.fromResponse(result.challenge), offer = challenge.request;
          assert.equal(challenge.realm, config.realmProfile === "ordinary" ? new URL(request.url).hostname : config.realmProfile);
          assert.equal(challenge.method, "evm"); assert.equal(challenge.intent, "charge"); assert.equal(offer.amount, "10000");
          assert.equal(offer.methodDetails.chainId, 84532); assert.equal(offer.currency.toLowerCase(), requirements.asset.toLowerCase()); assert.equal(offer.recipient.toLowerCase(), requirements.payTo.toLowerCase());
          assert.equal(result.challenge.headers.has("payment-required"), false);
          realmOffers.push({ profile: config.realmProfile, realm: challenge.realm, method: challenge.method, intent: challenge.intent, amount: offer.amount, network, urlSha256: hash(request.url), headerSha256: hash(result.challenge.headers.get("www-authenticate")), challengeSha256: hash(JSON.stringify(challenge)), idSha256: hash(challenge.id), economicSha256: hash(JSON.stringify([network, requirements.asset, requirements.payTo, offer.amount])) });
        }
        return result.challenge;
      }
      return result.withReceipt(application(hash(request.headers.get("authorization"))));
    };
  } else {
    const client = modules.pay.create0xkeyFacilitatorClient({ ...options, facilitatorResponseError: modules.core.FacilitatorResponseError });
    const http = makeServer(modules.core, modules.evm, client, "/paid", methodName);
    await http.initialize();
    route = async request => {
      const url = new URL(request.url), adapter = { getHeader: name => request.headers.get(name) ?? undefined, getMethod: () => request.method, getPath: () => url.pathname, getUrl: () => url.href, getAcceptHeader: () => request.headers.get("accept") ?? "", getUserAgent: () => "pay-conformance" };
      const context = { adapter, path: url.pathname, method: request.method, paymentHeader: request.headers.get("payment-signature") ?? undefined };
      const result = await http.processHTTPRequest(context);
      if (result.type === "payment-error") return new Response(result.response.body === undefined ? null : JSON.stringify(result.response.body), { status: result.response.status, headers: result.response.headers });
      assert.equal(result.type, "payment-verified");
      // This direct official caller owns its business idempotency. An HTTP
      // handler invocation is deliberately counted separately from its effect.
      const response = application(hash(request.headers.get("payment-signature")));
      const settlement = await http.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions, { request: context }, undefined, result.beforeHandlerSettlement);
      assert.equal(settlement.success, true);
      return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...settlement.headers } });
    };
  }
  const listener = await listen(tls, async (request, response) => {
    // Actual S/wire entry, before body reads, credential decoding or facade
    // selection. Discovery and signed requests remain phase-distinguishable.
    const wireArrival = (config.wireCaseId || config.wireDecoderCaseId || config.authorizationCaseId || config.mppAuthorizationCaseId) ? { stage: config.mppAuthorizationStage ?? config.authorizationStage ?? config.wireDecoderStage ?? (step === "proof" ? "positive" : "negative"), atNs: process.hrtime.bigint().toString(), bodyReadAtNs: null, protocol: request.headers["payment-signature"] ? request.headers.authorization ? "both" : "x402" : request.headers.authorization ? "mpp" : null, credentialSha256: request.headers[config.protocol === "mpp" ? "authorization" : "payment-signature"] ? hash(request.headers[config.protocol === "mpp" ? "authorization" : "payment-signature"]) : null, credentialHeadersSha256: hash(JSON.stringify([request.headers["payment-signature"] ?? null, request.headers.authorization ?? null])), bodySha256: null, responseStatus: null, completedAtNs: null } : null;
    if (wireArrival) {
      wireArrivals.push(wireArrival);
      response.once("finish", () => { wireArrival.responseStatus = response.statusCode; wireArrival.completedAtNs = process.hrtime.bigint().toString(); });
    }
    if (config.realmCaseId) realmArrivals.push({ atNs: process.hrtime.bigint().toString(), method: request.method, urlSha256: hash(request.url), protocol: request.headers["payment-signature"] ? request.headers.authorization ? "both" : "x402" : request.headers.authorization ? "mpp" : null });
    if (config.dualCaseId) dualArrivals.push({ atNs: process.hrtime.bigint().toString(), method: request.method, urlSha256: hash(request.url), protocol: request.headers["payment-signature"] ? request.headers.authorization ? "both" : "x402" : request.headers.authorization ? "mpp" : null });
    // Record a business arrival before any method, body or credential guard.
    const arrival = config.preflightCaseId ? { atNs: process.hrtime.bigint().toString(), method: request.method, urlSha256: hash(request.url), bodyReadAtNs: null, bodySha256: null, credentialSha256: null } : null;
    if (arrival) businessArrivals.push(arrival);
    if ((config.freezeCaseId || config.sellerCaseId === "handler-302" || config.authorizationOffer || config.authorizationCaseId || config.mppAuthorizationOffer || config.mppAuthorizationCaseId || config.networkMismatchFinal || config.mppNetworkMismatchFinal || config.amountMismatchFinal || config.mppAmountMismatchFinal || config.assetMismatchFinal || config.mppAssetMismatchFinal || config.payeeMismatchFinal || config.mppPayeeMismatchFinal) && request.url === "/redirect-target") { redirectTargets++; response.writeHead(200); response.end("forbidden-target"); return; }
    assert.equal(request.method, methodName); assert.equal(request.url, "/paid");
    const bytes = await body(request);
    if (wireArrival) { wireArrival.bodyReadAtNs = process.hrtime.bigint().toString(); wireArrival.bodySha256 = hash(bytes); }
    if (arrival) { arrival.bodyReadAtNs = process.hrtime.bigint().toString(); arrival.bodySha256 = hash(bytes); }
    assert.equal(bytes.toString(), preflightBody ? "preflight-original-body" : methodName === "POST" ? "freeze-original-body" : "");
    if (config.freezeCaseId) requestBodies.push(hash(bytes));
    const credential = config.dualCaseId ? request.headers["payment-signature"] ?? request.headers.authorization : config.protocol === "mpp" ? request.headers.authorization : request.headers["payment-signature"];
    if (arrival && credential) arrival.credentialSha256 = hash(credential);
    if (credential) received.push(hash(credential)); else count.challenge++;
    const requestStep = step;
    let result;
    try {
      if (config.freezeCaseId === "redirect-before-payment" || credential && config.freezeCaseId === "redirect-after-payment") result = new Response(null, { status: 302, headers: { Location: listener.origin + "/redirect-target" } });
      else if (credential && config.freezeCaseId === "other-protocol-error-text") result = Response.json({ error: `ignored ${oppositeProtocol} PAYMENT_IN_PROGRESS`, nonce: `${oppositeProtocol}-nonce` }, { status: 503 });
      else if (credential && config.freezeCaseId === "coincident-fields") {
        const selected = await route(new Request(listener.origin + "/paid")), opposite = await oppositeRoute(new Request(listener.origin + "/paid")), headers = new Headers(selected.headers);
        const oppositeName = oppositeProtocol === "mpp" ? "www-authenticate" : "payment-required"; headers.set(oppositeName, opposite.headers.get(oppositeName)); result = new Response(null, { status: 402, headers });
      } else if (credential && config.freezeCaseId === "other-protocol-shaped-nonce") {
        const selected = await route(new Request(listener.origin + "/paid")), headers = new Headers(selected.headers);
        if (config.protocol === "x402") { const decoded = modules.wire.decodePaymentRequiredHeader(headers.get("payment-required")); decoded.accepts[0].extra = { ...(decoded.accepts[0].extra ?? {}), nonce: "mpp-shaped-nonce" }; headers.set("payment-required", modules.wire.encodePaymentRequiredHeader(decoded)); }
        else { const challenge = modules.wire.Challenge.fromResponse(selected); challenge.meta = { ...(challenge.meta ?? {}), nonce: "0x" + "44".repeat(32) }; headers.set("www-authenticate", modules.wire.Challenge.serialize(challenge)); }
        result = new Response(null, { status: 402, headers });
      } else if (credential && oppositeRoute) result = await oppositeRoute(new Request(listener.origin + "/paid"));
      else result = await route(new Request(`${listener.origin}/paid`, { method: methodName, headers: request.headers, ...(methodName === "POST" ? { body: bytes } : {}) }));
      if (config.freezeCaseId && result.status === 402) {
        const switched = credential && oppositeRoute && config.freezeCaseId === "opposite-challenge-after-signature";
        const protocol = switched ? oppositeProtocol : config.protocol;
        const wire = switched ? modules.oppositeWire : modules.wire;
        const header = result.headers.get(protocol === "mpp" ? "www-authenticate" : "payment-required");
        assert.ok(header);
        if (protocol === "mpp") { const challenge = wire.Challenge.fromResponse(result); assert.equal(challenge.method, "evm"); assert.equal(challenge.intent, "charge"); }
        else assert.equal(wire.decodePaymentRequiredHeader(header).accepts[0].network, network);
        offers.push({ protocol, headerSha256: hash(header) });
      }
    }
    catch (error) {
      if (config.verifySettleRejectionFinal && config.protocol === "x402" && error instanceof modules.core.FacilitatorResponseError) {
        assert.equal(error.cause.code, "PAYMENT_AUTH_FORBIDDEN");
        result = Response.json({ errorCode: "PAYMENT_AUTH_FORBIDDEN", retryable: false }, { status: 403 });
      } else {
      // The official HTTP resource deliberately propagates its own dependency
      // exception. This direct caller owns the HTTP failure response; it must
      // not turn an indeterminate settlement into a fresh 402 challenge.
      if (!requestStep || (!config.payBuyer && !(config.sellerCaseId && requestStep === "accepted-503")) || config.protocol !== "x402" || !(error instanceof modules.core.FacilitatorResponseError)) throw error;
      dependencyErrors.push({ owner: "x402-facilitator", step: requestStep, messageSha256: hash(String(error.message)) });
      const exactStatus = requestStep?.startsWith("signed-") ? Number(requestStep.slice(7)) : null;
      const dependencyStatus = exactStatus ?? (["unknown", "disconnect", "timeout", "accepted-503", "accepted-disconnect", "accepted-timeout"].includes(requestStep) ? 503 : 502);
      result = requestStep === "accepted-503" ? Response.json({ errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true }, { status: dependencyStatus }) : new Response(null, { status: dependencyStatus });
      }
    }
    if (!credential && config.offerCaseId) {
      assert.equal(result.status, 402);
      const mpp = config.protocol === "mpp", name = mpp ? "www-authenticate" : "payment-required";
      const headers = new Headers(result.headers), original = headers.get(name); assert.ok(original);
      // Validate the genuine selected native offer before a wire-only mutation.
      if (mpp) { const challenge = modules.wire.Challenge.fromResponse(result); assert.equal(challenge.method, "evm"); assert.equal(challenge.intent, "charge"); }
      else assert.equal(modules.wire.decodePaymentRequiredHeader(original).accepts[0].network, network);
      const matches = mpp ? [...original.matchAll(/(?:^|,\s*)request="([^"]+)"/g)] : [];
      if (mpp) assert.equal(matches.length, 1);
      const encoded = mpp ? matches[0][1] : original;
      const parameter = { "session-intent": "intent", "non-evm-method": "method", "expired-challenge": "expires" }[config.offerCaseId];
      const parameterPattern = parameter ? new RegExp(',\\s*' + parameter + '="[^"]*"', "g") : null;
      const envelope = header => parameter ? header.replace(parameterPattern, "") : mpp ? header.replace(/(request=")[^"]+("(?:,|$))/, "$1$2") : "";
      let changed = original, field = "none";
      let unchanged, normalizeSingleField;
      const singleFieldCase = ["unsupported-scheme", "upto", "permit2", "unknown-required-extension", "invalid-recipient-offer", "non-usdc-offer", "wrong-network-usdc", "wrong-decimals", "above-ceiling", "negative", "non-integer-atomic", "malformed-price"].includes(config.offerCaseId);
      if (parameter) {
        assert.equal(mpp, true);
        const occurrences = [...original.matchAll(parameterPattern)];
        assert.ok(parameter === "expires" ? occurrences.length <= 1 : occurrences.length === 1);
        if (step !== "proof") {
          const value = { intent: "session", method: "tempo", expires: "2000-01-01T00:00:00.000Z" }[parameter];
          // Keep the native encoded request, HMAC id, and all other bytes.
          // This is a buyer-side parser/selection/expiry control, not a newly
          // authenticated server challenge or a native serializer claim.
          changed = occurrences.length ? original.replace(parameterPattern, ', ' + parameter + '="' + value + '"') : original + ', expires="' + value + '"';
          field = "challenge." + parameter;
        }
        const afterMatches = [...changed.matchAll(/(?:^|,\s*)request="([^"]+)"/g)]; assert.equal(afterMatches.length, 1);
        assert.equal(afterMatches[0][1], encoded);
        unchanged = { unchangedBeforeSha256: hash(envelope(original)), unchangedAfterSha256: hash(envelope(changed)), requestBeforeSha256: hash(encoded), requestAfterSha256: hash(afterMatches[0][1]) };
      } else if (step !== "proof") {
        const id = config.offerCaseId;
        let replacement;
        if (id.startsWith("header-")) {
          field = mpp ? "request-encoding" : "header-encoding";
          replacement = id === "header-invalid-base64" ? "%%%" : Buffer.from("{").toString(mpp ? "base64url" : "base64");
        } else {
          // Mutate the real encoded bytes, not a serializer that could reject
          // the invalid field before the public buyer receives the response.
          const value = JSON.parse(Buffer.from(encoded, "base64url").toString()), before = structuredClone(value);
          if (!mpp) assert.equal(value.accepts.length, 1);
          const request = mpp ? value : value.accepts[0];
          assert.equal(request.amount, "10000"); assert.equal(mpp ? request.methodDetails.chainId : request.network, mpp ? 84532 : network);
          assert.equal((mpp ? request.currency : request.asset).toLowerCase(), requirements.asset.toLowerCase());
          assert.equal((mpp ? request.recipient : request.payTo).toLowerCase(), requirements.payTo.toLowerCase());
          let target = request, key, changedValue;
          if (["other-base-network-offer", "unsupported-chain-offer"].includes(id)) {
            const chain = id === "other-base-network-offer" ? 8453 : 1;
            target = mpp ? request.methodDetails : request; key = mpp ? "chainId" : "network"; changedValue = mpp ? chain : "eip155:" + chain;
            field = mpp ? "request.methodDetails.chainId" : "accepts.network";
          } else if (id === "wrong-decimals") {
            target = request.methodDetails; key = "decimals"; changedValue = 18; field = "request.methodDetails.decimals";
          } else if (["non-usdc-offer", "wrong-network-usdc"].includes(id)) {
            key = mpp ? "currency" : "asset"; changedValue = id === "non-usdc-offer" ? "0x2222222222222222222222222222222222222222" : "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
            field = mpp ? "request.currency" : "accepts.asset";
          } else if (id === "invalid-recipient-offer") {
            key = mpp ? "recipient" : "payTo"; changedValue = "not-an-address"; field = mpp ? "request.recipient" : "accepts.payTo";
          } else if (["unsupported-scheme", "upto"].includes(id)) {
            assert.equal(mpp, false); assert.equal(request.scheme, "exact");
            key = "scheme"; changedValue = id === "upto" ? "upto" : "unsupported"; field = "accepts.scheme";
          } else if (["permit2", "unknown-required-extension"].includes(id)) {
            assert.equal(mpp, false); assert.equal(request.scheme, "exact"); assert.ok(request.extra);
            target = request.extra; key = "assetTransferMethod"; changedValue = id === "permit2" ? "permit2" : "future-transfer"; field = "accepts.extra.assetTransferMethod";
          } else {
            key = "amount"; changedValue = { "above-ceiling": "100001", negative: "-1", "non-integer-atomic": "1.5", "malformed-price": "USD0.01" }[id]; assert.ok(changedValue);
            field = mpp ? "request.amount" : "accepts.amount";
          }
          const present = Object.hasOwn(target, key), previous = target[key]; assert.notEqual(previous, changedValue); target[key] = changedValue;
          replacement = mpp ? Buffer.from(JSON.stringify(value)).toString("base64url") : config.networkMismatchFinal || config.amountMismatchFinal || config.assetMismatchFinal || config.payeeMismatchFinal ? modules.wire.encodePaymentRequiredHeader(value) : Buffer.from(JSON.stringify(value)).toString("base64");
          if (present) target[key] = previous; else delete target[key];
          assert.deepEqual(value, before, "ONLY_DECLARED_OFFER_FIELD_CHANGES");
        }
        changed = mpp ? original.replace(encoded, replacement) : replacement;
      }
      if (singleFieldCase) {
        // Independently parse the transmitted bytes, then omit only the
        // declared member from both documents; every other member is bound.
        normalizeSingleField = header => {
          const raw = mpp ? [...header.matchAll(/(?:^|,\s*)request="([^"]+)"/g)][0][1] : header;
          const value = JSON.parse(Buffer.from(raw, "base64url").toString()), request = mpp ? value : value.accepts[0];
          if (["unsupported-scheme", "upto"].includes(config.offerCaseId)) delete request.scheme;
          else if (["permit2", "unknown-required-extension"].includes(config.offerCaseId)) delete request.extra.assetTransferMethod;
          else if (config.offerCaseId === "invalid-recipient-offer") delete request[mpp ? "recipient" : "payTo"];
          else if (config.offerCaseId === "wrong-decimals") delete request.methodDetails.decimals;
          else if (["non-usdc-offer", "wrong-network-usdc"].includes(config.offerCaseId)) delete request[mpp ? "currency" : "asset"];
          else delete request.amount;
          return JSON.stringify(value);
        };
        assert.equal(normalizeSingleField(original), normalizeSingleField(changed));
        unchanged = { unchangedBeforeSha256: hash(normalizeSingleField(original)), unchangedAfterSha256: hash(normalizeSingleField(changed)) };
      }
      assert.equal(envelope(original), envelope(changed));
      let codecEvidence = {};
      if (config.networkMismatchFinal || config.amountMismatchFinal || config.assetMismatchFinal || config.payeeMismatchFinal) {
        assert.equal(mpp, false);
        const decoded = modules.wire.decodePaymentRequiredHeader(changed);
        assert.equal(modules.wire.encodePaymentRequiredHeader(decoded), changed);
        if (config.assetMismatchFinal) codecEvidence = { decodedAssetSha256: hash(decoded.accepts[0].asset), codecOwner: `@x402/core@${inventory.find(entry => entry.name === "@x402/core/server")?.version}`, decoder: "decodePaymentRequiredHeader", encoder: "encodePaymentRequiredHeader" };
        else if (config.networkMismatchFinal) codecEvidence = { decodedNetwork: decoded.accepts[0].network, codecOwner: `@x402/core@${inventory.find(entry => entry.name === "@x402/core/server")?.version}`, decoder: "decodePaymentRequiredHeader", encoder: "encodePaymentRequiredHeader" };
      } else if (config.mppNetworkMismatchFinal || config.mppPayeeMismatchFinal || config.mppAmountMismatchFinal || config.mppAssetMismatchFinal) {
        assert.equal(mpp, true);
        const decoded = modules.wire.Challenge.fromResponse(new Response(null, { status: 402, headers: { "www-authenticate": changed } }));
        changed = modules.wire.Challenge.serialize(decoded);
        const transmitted = modules.wire.Challenge.fromResponse(new Response(null, { status: 402, headers: { "www-authenticate": changed } }));
        assert.equal(modules.wire.Challenge.serialize(transmitted), changed);
        if (config.mppPayeeMismatchFinal || config.mppAmountMismatchFinal || config.mppAssetMismatchFinal) {
          assert.ok(normalizeSingleField);
          const before = normalizeSingleField(original), after = normalizeSingleField(changed);
          assert.equal(before, after);
          assert.equal(envelope(original), envelope(changed));
          unchanged = { unchangedBeforeSha256: hash(before), unchangedAfterSha256: hash(after) };
        }
        codecEvidence = config.mppPayeeMismatchFinal || config.mppAmountMismatchFinal || config.mppAssetMismatchFinal
          ? { ...(config.mppPayeeMismatchFinal ? { decodedPayeeSha256: hash(transmitted.request.recipient) } : config.mppAssetMismatchFinal ? { decodedAssetSha256: hash(transmitted.request.currency), decodedDecimals: transmitted.request.methodDetails.decimals } : { decodedAmountSha256: hash(transmitted.request.amount) }), codecOwner: `mppx@${inventory.find(entry => entry.name === "mppx")?.version}`, decoder: "Challenge.fromResponse", encoder: "Challenge.serialize" }
          : { decodedChainId: decoded.request.methodDetails.chainId, codecOwner: `mppx@${inventory.find(entry => entry.name === "mppx")?.version}`, decoder: "Challenge.fromResponse", encoder: "Challenge.serialize" };
      }
      offerChanges.push({ caseId: config.offerCaseId, stage: step === "proof" ? "positive" : "negative", field, beforeSha256: hash(original), afterSha256: hash(changed), envelopeBeforeSha256: hash(envelope(original)), envelopeAfterSha256: hash(envelope(changed)), ...unchanged, ...codecEvidence });
      headers.set(name, changed); result = new Response(result.body, { status: result.status, headers });
    }
    if (credential && ["missing", "malformed", "mismatch"].includes(step)) {
      const headers = new Headers(result.headers), name = config.protocol === "mpp" ? "Payment-Receipt" : "PAYMENT-RESPONSE";
      assert.ok(headers.has(name), "RECEIPT_MUTATION_REQUIRES_SUCCESS");
      if (step === "missing") headers.delete(name);
      else if (step === "malformed") headers.set(name, "malformed");
      else if (config.protocol === "mpp") headers.set(name, modules.wire.Receipt.serialize({ ...modules.wire.Receipt.fromResponse(result), reference: "0x" + "ef".repeat(32) }));
      else headers.set(name, modules.wire.encodePaymentResponseHeader({ ...modules.wire.decodePaymentResponseHeader(headers.get(name)), network: "eip155:8453" }));
      result = new Response(result.body, { status: result.status, headers });
    }
    if (credential && config.receiptCaseId) {
      const headers = new Headers(result.headers), name = config.protocol === "mpp" ? "Payment-Receipt" : "PAYMENT-RESPONSE";
      const original = headers.get(name); assert.ok(original, "RECEIPT_MUTATION_REQUIRES_NATIVE_SUCCESS");
      const decoded = config.protocol === "mpp" ? modules.wire.Receipt.fromResponse(result) : modules.wire.decodePaymentResponseHeader(original);
      assert.equal("paymentId" in decoded, false);
      let field = "none", changed = original;
      if (step !== "proof") {
        field = "header-value";
        if (config.receiptCaseId === "absent") { headers.delete(name); changed = null; }
        else if (config.receiptCaseId === "invalid-base64") changed = "%%%";
        else if (config.receiptCaseId === "invalid-json") changed = Buffer.from("{").toString(config.protocol === "mpp" ? "base64url" : "base64");
        else if (config.receiptCaseId === "wrong-protocol-header") {
          field = "header-name"; headers.delete(name); headers.set(config.protocol === "mpp" ? "PAYMENT-RESPONSE" : "Payment-Receipt", original); changed = null;
        } else if (config.receiptCaseId === "malformed-required-field") {
          field = config.protocol === "mpp" ? "reference" : "transaction";
          // Explicit wire mutation of a genuine native receipt. Do not ask a
          // native serializer to endorse an invalid schema or count its throw.
          const value = JSON.parse(Buffer.from(original, "base64url").toString()); delete value[field];
          changed = Buffer.from(JSON.stringify(value)).toString(config.protocol === "mpp" ? "base64url" : "base64");
        } else if (["wrong-receipt-network", "wrong-receipt-transaction"].includes(config.receiptCaseId)) {
          field = config.receiptCaseId === "wrong-receipt-network" ? "network" : config.protocol === "mpp" ? "reference" : "transaction";
          const value = { ...decoded, [field]: field === "network" ? "eip155:8453" : "0x" + "ef".repeat(32) };
          changed = config.protocol === "mpp" ? modules.wire.Receipt.serialize(value) : modules.wire.encodePaymentResponseHeader(value);
        } else field = "none"; // Proof-only mutations keep native receipt bytes.
        if (changed !== null) headers.set(name, changed);
      }
      receiptChanges.push({ caseId: config.receiptCaseId, stage: step === "proof" ? "proof" : "negative", field, beforeSha256: hash(original), afterSha256: changed === null ? null : hash(changed) });
      result = new Response(result.body, { status: result.status, headers });
    }
    if (duplicateCase && config.protocol === "x402" && !credential && step !== "proof") {
      // Two physical fields cross Node HTTPS; the buyer records the actual
      // coalesced value it receives, independently of these component hashes.
      assert.equal(result.status, 402); assert.equal(duplicateHeaders.length, 2);
      response.writeHead(402, { "Payment-Required": duplicateHeaders }); response.end();
    } else await respond(response, result);
  }, failure => failures.push(failure));
  send({ type: "ready", port: listener.port });
  await serveControl(listener.server, () => ({ counters: count, failures, events, received, dependencyErrors, ...((config.wireCaseId || config.wireDecoderCaseId || config.authorizationCaseId || config.mppAuthorizationCaseId) ? { wireArrivals } : {}), ...(config.freezeCaseId ? { redirectTargets, offers, requestBodies } : {}), ...(config.authorizationOffer || config.authorizationCaseId || config.mppAuthorizationOffer || config.mppAuthorizationCaseId || config.networkMismatchFinal || config.mppNetworkMismatchFinal || config.amountMismatchFinal || config.mppAmountMismatchFinal || config.assetMismatchFinal || config.mppAssetMismatchFinal || config.payeeMismatchFinal || config.mppPayeeMismatchFinal ? { redirectTargets } : {}), ...(config.receiptCaseId ? { receiptChanges } : {}), ...(config.offerCaseId ? { offerChanges } : {}), ...(config.sellerCaseId ? { handlerObservations, fulfillmentObservations, redirectTargets } : {}), ...(config.supportCaseId ? { supportTransports } : {}), ...(config.preflightCaseId ? { businessArrivals } : {}), ...(config.dualCaseId ? { dualOffers, dualArrivals, protocolCounters, ...duplicateCase ? { duplicate } : {} } : {}), ...(config.realmCaseId ? { realmOffers, realmArrivals } : {}) }), value => { step = value; });
} catch (error) {
  send({ type: "failure", messageSha256: hash(String(error?.message)) }); process.exitCode = 1;
  if (process.connected) process.disconnect();
}
