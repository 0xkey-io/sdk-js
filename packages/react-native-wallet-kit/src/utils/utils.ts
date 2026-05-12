import {
  Session,
  ZeroXKeyError,
  ZeroXKeyErrorCodes,
} from "@0xkey-io/sdk-types";
import { useCallback, useRef } from "react";

export const SESSION_WARNING_THRESHOLD_MS = 60 * 1000; // 1 minute in milliseconds

export const authErrors = {
  // Passkey-related errors
  passkey: {
    createFailed: "Passkey not created. Please try again.",
    loginFailed: "Failed to login with passkey. Please try again.",
    timeoutOrNotAllowed:
      "The operation either timed out or was not allowed. Please try again.",
  },

  // OTP-related errors
  otp: {
    sendFailed: "Failed to send OTP",
    invalidEmail: "Invalid email address.",
    invalidPhone: "Invalid phone number.",
  },

  // OAuth-related errors
  oauth: {
    loginFailed: "Failed to login with OAuth provider",
  },

  // Sub-organization-related errors
  suborg: {
    fetchFailed: "Failed to fetch account",
    createFailed: "Failed to create account.",
  },
};

export const useDebouncedCallback = <T extends (...args: any[]) => void>(
  fn: T,
  wait = 100,
): T => {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback(
    (...args: any[]) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        fnRef.current(...(args as Parameters<T>));
        timer.current = null;
      }, wait);
    },
    [wait],
  ) as T;
};

export const isValidSession = (session?: Session | undefined): boolean => {
  return session?.expiry !== undefined && session.expiry * 1000 > Date.now();
};

export async function withZeroXKeyErrorHandling<T>(
  fn: () => Promise<T>,
  sessionExpireFn: () => Promise<void>,
  callbacks?: { onError?: (error: ZeroXKeyError) => void },
  fallbackMessage = "An unknown error occurred",
  fallbackCode = ZeroXKeyErrorCodes.UNKNOWN,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    let tkError: ZeroXKeyError;

    if (error instanceof ZeroXKeyError) {
      tkError = error;

      if (tkError.code === ZeroXKeyErrorCodes.SESSION_EXPIRED) {
        await sessionExpireFn();
      }

      // skip onError for WalletConnect expired errors
      if (tkError.code !== ZeroXKeyErrorCodes.WALLET_CONNECT_EXPIRED) {
        callbacks?.onError?.(tkError);
      }

      throw tkError;
    }

    // we wrap non-ZeroXKey errors
    tkError = new ZeroXKeyError(fallbackMessage, fallbackCode, error);
    callbacks?.onError?.(tkError);
    throw tkError;
  }
}
