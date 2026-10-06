import type { ClientContextType } from "../providers/client/Types";

declare const context: ClientContextType;

context.signUpWithPasskey();
const gate = async (submit: () => Promise<unknown>) => submit();
const walletInput = {} as Parameters<ClientContextType["signUpWithWallet"]>[0];
const mixedInput = {} as Parameters<
  ClientContextType["loginOrSignupWithWallet"]
>[0];
// @ts-expect-error React owns the Captcha gate and does not accept one from callers.
context.signUpWithPasskey(undefined, gate);

// @ts-expect-error React owns the Captcha gate and does not accept one from callers.
context.signUpWithWallet(walletInput, gate);

// @ts-expect-error React owns the Captcha gate and does not accept one from callers.
context.loginOrSignupWithWallet(mixedInput, gate);
