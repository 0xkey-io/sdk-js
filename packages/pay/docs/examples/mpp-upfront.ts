import { Errors } from "mppx";
import { Mppx } from "mppx/server";
import {
  create0xkeyEvmChargeMethod,
  type Create0xkeyEvmChargeMethodOptions,
} from "@0xkey-io/pay/mpp";

// Errors and Mppx must come from the same physical native mppx owner.
// Tested against pinned 0.8.19/0.8.17 owners; Pay's exact 0.8.19 peer remains.
export function createUpfrontMpp(
  options: Omit<Create0xkeyEvmChargeMethodOptions, "paymentError">,
  secretKey: string,
) {
  const method = create0xkeyEvmChargeMethod({
    ...options,
    paymentError: Errors.PaymentError,
  });
  return Mppx.create({ methods: [method], secretKey }).evm.charge({
    amount: "0.01",
  });
}

// Return result.challenge for the native 402 branch, even when the contained
// HTTP response is 503/403. Only the success branch calls the paid handler and
// withReceipt; it adds a receipt only if the handler response is 2xx.
// Raw buyers still own durable same-credential recovery after a signed 5xx.
