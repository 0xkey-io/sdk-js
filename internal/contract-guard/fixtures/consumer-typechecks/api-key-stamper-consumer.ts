import {
  ApiKeyStamper,
  SignatureFormat,
  signWithApiKey,
  type Runtime,
  type TApiKeyStamperConfig,
} from "../../../../packages/api-key-stamper/dist/index";

const config: TApiKeyStamperConfig = {
  apiPublicKey: "00".repeat(33),
  apiPrivateKey: "00".repeat(32),
  runtimeOverride: "node" satisfies Runtime,
};

const stamper = new ApiKeyStamper(config);

async function demo() {
  const signed = await signWithApiKey(
    {
      content: "payload",
      publicKey: config.apiPublicKey,
      privateKey: config.apiPrivateKey,
    },
    "node",
  );

  const stamped = await stamper.stamp("payload");
  const raw = await stamper.sign("payload", SignatureFormat.Raw);

  return { signed, stamped, raw };
}

export { demo, stamper };
