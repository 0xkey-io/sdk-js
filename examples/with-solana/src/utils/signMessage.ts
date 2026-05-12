import type { ZeroXKeySigner } from "@0xkey-io/solana";

/**
 * Sign a message with a ZeroXKey Solana address.
 * @param signer
 * @param fromAddress
 * @param message
 */
export async function signMessage(input: {
  signer: ZeroXKeySigner;
  fromAddress: string;
  message: string;
}): Promise<Uint8Array> {
  const { signer, fromAddress, message } = input;
  const messageAsUint8Array = Buffer.from(message);

  const signature = await signer.signMessage(messageAsUint8Array, fromAddress);

  return signature;
}
