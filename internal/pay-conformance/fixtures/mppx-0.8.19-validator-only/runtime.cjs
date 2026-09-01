'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { once } = require('node:events');
const { createRequire } = require('node:module');

const [fixtureRoot, appRoot, certDir, output] = process.argv.slice(2);
if (!fixtureRoot || !appRoot || !certDir || !output) throw new Error('usage: validator-runtime.cjs FIXTURE APP CERTDIR OUTPUT');
const resultPath = path.resolve(output);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = (file) => hash(fs.readFileSync(file));
const fail = (label) => { throw Object.assign(new Error(label), { label }); };
const check = (condition, label) => { if (!condition) fail(label); };
const safeError = (error) => ({ label: error && (error.label || error.name) || 'Error', code: error && error.code || null, message: error && error.message || String(error) });
const events = [];
const emit = (type, value = {}) => { const event = { type, ...value }; events.push(event); process.stdout.write(JSON.stringify(event) + '\n'); };

const verifierRequire = createRequire(path.join(fixtureRoot, 'package.json'));
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const validationEntry = verifierRequire.resolve('mppx/validation');
const payEntry = appRequire.resolve('@0xkey-io/pay/server');
const validationManifest = fs.realpathSync(path.join(path.dirname(validationEntry), '..', '..', 'package.json'));
const payManifest = fs.realpathSync(path.join(path.dirname(payEntry), '..', '..', 'package.json'));
const validationMeta = JSON.parse(fs.readFileSync(validationManifest, 'utf8'));
const payMeta = JSON.parse(fs.readFileSync(payManifest, 'utf8'));
check(validationMeta.version === '0.8.19', 'validator-mppx-version');
check(payMeta.name === '@0xkey-io/pay' && payMeta.version === '1.0.0-rc.1', 'packed-pay-version');
const { validate } = verifierRequire('mppx/validation');
const pay = appRequire('@0xkey-io/pay/server');

const correctCa = fs.readFileSync(path.join(certDir, 'ca.pem'));
const wrongCa = fs.readFileSync(path.join(certDir, 'wrong-ca.pem'));
const tls = { key: fs.readFileSync(path.join(certDir, 'server.key')), cert: fs.readFileSync(path.join(certDir, 'server.pem')) };
const allowed = new Set();
const requests = [];
const privateRequestAttempts = [];
let server;
let origin;
let closed = false;

async function fetchTls(input, init = {}, ca = correctCa) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  check(url.protocol === 'https:' && url.hostname === '127.0.0.1' && allowed.has(url.origin) && !url.username && !url.password, 'network-allowlist');
  const body = Buffer.from(await request.arrayBuffer());
  check(body.length <= 65536, 'outgoing-body-bound');
  return await new Promise((resolve, reject) => {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    const req = https.request(url, { method: request.method, headers: Object.fromEntries(request.headers), ca, rejectUnauthorized: true, agent: false, signal }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 131072) req.destroy(new Error('incoming-response-bound'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          check(res.statusCode < 300 || res.statusCode >= 400, 'redirect-rejected');
          const response = new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers });
          Object.defineProperty(response, 'url', { value: url.href });
          resolve(response);
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error('socket-timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

async function readRequest(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    check(bytes <= 65536, 'incoming-request-bound');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function closeServer() {
  if (!server || closed) return;
  closed = true;
  const port = server.address() && server.address().port;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  emit('listener-closed', { port });
}

async function main() {
  emit('inventory', {
    node: process.version,
    validator: { version: validationMeta.version, entry: validationEntry, entrySha256: fileHash(validationEntry), manifest: validationManifest, manifestSha256: fileHash(validationManifest) },
    seller: { name: payMeta.name, version: payMeta.version, entry: payEntry, entrySha256: fileHash(payEntry), manifest: payManifest, manifestSha256: fileHash(payManifest) },
    publicImportsOnly: true,
  });
  server = https.createServer(tls, async (req, res) => {
    try {
      check(req.socket.encrypted === true, 'incoming-https-required');
      const body = await readRequest(req);
      const authPresent = typeof req.headers.authorization === 'string';
      requests.push({ method: req.method, path: req.url, authorization: authPresent ? 'present' : 'absent', bytes: body.length });
      if (req.url === '/health' && req.method === 'GET') { res.writeHead(200); res.end('ok'); return; }
      if (req.url === '/openapi.json' && req.method === 'GET') {
        const doc = { openapi: '3.1.0', info: { title: 'Synthetic local Pay validator seller', version: '1' }, paths: { '/paid': { get: { 'x-payment-info': { amount: '10000' }, responses: { '402': { description: 'Payment Required' } } } } } };
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(JSON.stringify(doc))) });
        res.end(JSON.stringify(doc));
        return;
      }
      if (req.url !== '/paid' || req.method !== 'GET') fail('unexpected-inbound-route');
      const request = new Request(origin + req.url, { method: req.method, headers: req.headers, body: body.length ? body : undefined });
      if (authPresent) check(req.headers.authorization === 'Payment dGhpcyBpcyBnYXJiYWdl', 'only-library-malformed-credential');
      const response = await protectedRoute(request);
      check(response.status !== 200, 'unexpected-paid-success');
      requests[requests.length - 1].status = response.status;
      requests[requests.length - 1].wwwAuthenticate = response.headers.has('www-authenticate');
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      emit('server-failure', safeError(error));
      res.writeHead(500); res.end('fixture failure');
    }
  });
  server.requestTimeout = 12_000;
  server.headersTimeout = 12_000;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `https://127.0.0.1:${server.address().port}`;
  allowed.add(origin);
  emit('listener-ready', { origin, port: server.address().port });

  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const apiKey = { publicKey: ecdh.getPublicKey('hex', 'compressed'), privateKey: ecdh.getPrivateKey('hex').padStart(64, '0') };
  const payServer = pay.createPayServer({ network: 'eip155:84532', organizationId: '11111111-1111-4111-8111-111111111111', payTo: '0x1111111111111111111111111111111111111111', apiKey, facilitatorUrl: origin, fetch: fetchTls, protocols: ['mpp'], mppSecretKey: crypto.randomBytes(32).toString('hex'), handlerRevision: 'validator-runtime-readiness-v1' });
  globalThis.fetch = fetchTls;
  protectedRoute = payServer.protect({ price: '$0.01', description: 'Synthetic local validator challenge only' }, () => { fail('paid-handler-must-not-run'); });

  const health = await fetchTls(origin + '/health');
  check(health.status === 200 && await health.text() === 'ok', 'correct-ca-health');
  let wrongCaRejected = false;
  let wrongCaCode = null;
  try { await fetchTls(origin + '/health', {}, wrongCa); } catch (error) { wrongCaCode = error.code || error.name; wrongCaRejected = ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_SIGNATURE_FAILURE'].includes(wrongCaCode); }
  check(wrongCaRejected, 'wrong-ca-not-rejected');
  emit('tls-controls', { correctCaStatus: 200, wrongCaRejected, wrongCaCode });
  requests.length = 0;

  const result = await validate({ url: origin, skipPayment: true, verbose: false, interactive: false });
  const endpoint = result.endpoints[0];
  check(result.discovery.found && result.discovery.valid, 'discovery-not-valid');
  check(result.endpoints.length === 1 && endpoint.method === 'GET' && endpoint.path === '/paid', 'endpoint-not-discovered');
  check(endpoint.challenge.some((r) => r.label === 'Challenge parseable' && r.severity === 'pass'), 'challenge-not-parsed');
  check(endpoint.errorHandling.length > 0, 'error-check-not-emitted');
  check(endpoint.payment.length === 0, 'skip-payment-did-not-suppress-phase');
  check(requests.length === 3, `unexpected-request-count:${requests.length}`);
  check(JSON.stringify(requests.map((r) => [r.method, r.path, r.authorization])) === JSON.stringify([['GET', '/openapi.json', 'absent'], ['GET', '/paid', 'absent'], ['GET', '/paid', 'present']]), 'unexpected-request-shape');
  check(privateRequestAttempts.length === 0, 'private-request-observed');
  const publicResult = {
    discovery: { found: result.discovery.found, valid: result.discovery.valid, checks: result.discovery.checks },
    endpoint: { method: endpoint.method, path: endpoint.path, challenge: endpoint.challenge, errorHandling: endpoint.errorHandling, payment: endpoint.payment },
    summary: result.summary,
    requestCount: requests.length,
    requestShape: requests,
    paymentEvents: 0,
    privateRequestAttempts: privateRequestAttempts.length,
    skipPayment: true,
    tls: { wrongCaRejected, wrongCaCode },
  };
  fs.writeFileSync(resultPath, JSON.stringify(publicResult, null, 2) + '\n', { mode: 0o600 });
  emit('PASS', { discoveryChecks: result.discovery.checks.length, challengeChecks: endpoint.challenge.length, errorChecks: endpoint.errorHandling.length, errorSeverities: endpoint.errorHandling.map((r) => r.severity), paymentChecks: endpoint.payment.length, requests: requests.length, privateRequestAttempts: privateRequestAttempts.length, skipPayment: true });
}

let protectedRoute;
const watchdog = setTimeout(() => { emit('fatal', { label: 'inner-90s-deadline' }); process.exit(3); }, 90_000); watchdog.unref();
main().catch((error) => { emit('FAIL', safeError(error)); process.exitCode = 1; }).finally(async () => { await closeServer(); clearTimeout(watchdog); });
