import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";

import { createPayServer } from "../dist/server/index.mjs";

const fixtureRoot = new URL(
  "../../api-key-stamper/src/__fixtures__/",
  import.meta.url,
);
const [publicKey, privateKey] = await Promise.all([
  readFile(new URL("api-key.public", fixtureRoot), "utf8").then((value) =>
    value.trim(),
  ),
  readFile(new URL("api-key.private", fixtureRoot), "utf8").then((value) =>
    value.trim(),
  ),
]);
const paymentServer = createPayServer({
  network: "eip155:84532",
  organizationId: "11111111-1111-1111-1111-111111111111",
  payTo: "0x1111111111111111111111111111111111111111",
  apiKey: { publicKey, privateKey },
  mppSecretKey: "01234567890123456789012345678901",
  async fetch(url, init) {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/verify")) {
      return Response.json({
        isValid: true,
        payer: body.paymentPayload.payload.authorization.from,
      });
    }
    return Response.json({
      success: true,
      transaction: `0x${"ef".repeat(32)}`,
      network: body.paymentRequirements.network,
      payer: body.paymentPayload.payload.authorization.from,
      paymentId: "22222222-2222-2222-2222-222222222222",
    });
  },
});

const httpServer = http.createServer(async (incoming, outgoing) => {
  try {
    if (incoming.method === "GET" && incoming.url === "/openapi.json") {
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(
        JSON.stringify({
          openapi: "3.1.0",
          info: { title: "0xkey Pay validation", version: "0.3.0-rc.3" },
          paths: {
            "/weather": {
              get: {
                responses: {
                  200: { description: "Weather response" },
                  402: { description: "Payment Required" },
                },
                "x-payment-info": {
                  offers: [
                    {
                      amount: "10000",
                      currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                      intent: "charge",
                      method: "evm",
                    },
                  ],
                },
              },
            },
          },
        }),
      );
      return;
    }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const method = incoming.method ?? "GET";
    const request = new Request(
      `http://127.0.0.1:${httpServer.address().port}${incoming.url ?? "/"}`,
      {
        method,
        headers: incoming.headers,
        ...(!["GET", "HEAD"].includes(method)
          ? { body: Buffer.concat(chunks), duplex: "half" }
          : {}),
      },
    );
    const payment = await paymentServer.handle(request, {
      price: "$0.01",
      protocols: ["x402", "mpp"],
    });
    const response =
      payment.status === 200
        ? payment.withReceipt(Response.json({ weather: "sunny" }))
        : payment.response;
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.writeHead(500);
    outgoing.end(String(error));
  }
});

await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
const address = httpServer.address();
assert.equal(typeof address, "object");
const validateArgs = [
  "validate",
  `http://127.0.0.1:${address.port}`,
  "--endpoint",
  "GET:/weather",
  "--yes",
  "--output-json",
];
const compatibilityVersion = process.env.MPPX_COMPAT_VERSION;
const cli = compatibilityVersion
  ? "pnpm"
  : new URL("../node_modules/.bin/mppx", import.meta.url).pathname;
const cliArgs = compatibilityVersion
  ? ["dlx", `mppx@${compatibilityVersion}`, ...validateArgs]
  : validateArgs;
const result = await new Promise((resolve) => {
  const child = spawn(cli, cliArgs, {
    env: {
      ...process.env,
      MPPX_PRIVATE_KEY:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.on("close", (code) => resolve({ code, stdout, stderr }));
});
httpServer.close();
assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
console.log(
  `mppx ${compatibilityVersion ?? "0.8.17"} validate: 0xkey MPP server passed`,
);
