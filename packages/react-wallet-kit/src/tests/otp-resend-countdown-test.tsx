/**
 * @jest-environment jsdom
 */
import "./fixtures/text-encoding";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  OtpType,
  ZeroXKeyErrorCodes,
  ZeroXKeyRateLimitError,
} from "@0xkey-io/core";
import { OtpVerification } from "../components/auth/OTP";
import { EmailInput } from "../components/auth/Email";

const mockInitOtp = jest.fn(
  async (_params: unknown): Promise<unknown> => ({
    otpId: "otp-2",
    otpEncryptionTargetBundle: "bundle-2",
  }),
);

jest.mock("../providers/client/Hook", () => ({
  useZeroXKey: () => ({
    config: {},
    initOtp: mockInitOtp,
    completeOtp: jest.fn(),
  }),
}));

jest.mock("../providers/modal/Hook", () => ({
  useModal: () => ({ closeModal: jest.fn(), isMobile: false }),
}));

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers({ now: new Date("2026-10-08T00:00:00Z") });
  mockInitOtp.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
});

function resendButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => /Resend/.test(candidate.textContent ?? ""),
  );
  if (!button) throw new Error("resend button not rendered");
  return button;
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

function renderOtp() {
  act(() => {
    root.render(
      <OtpVerification
        contact="a@example.test"
        otpId="otp-1"
        otpEncryptionTargetBundle="bundle-1"
        otpType={OtpType.Email}
      />,
    );
  });
}

describe("OtpVerification resend countdown", () => {
  it("keeps resend disabled for 60 seconds after the code was sent", async () => {
    renderOtp();
    expect(resendButton().disabled).toBe(true);
    expect(resendButton().textContent).toBe("Resend code in 60s");

    await advance(1000);
    expect(resendButton().textContent).toBe("Resend code in 59s");

    await act(async () => resendButton().click());
    expect(mockInitOtp).not.toHaveBeenCalled();

    await advance(59_000);
    expect(resendButton().disabled).toBe(false);
    expect(resendButton().textContent).toBe("Resend Code");

    await act(async () => resendButton().click());
    expect(mockInitOtp).toHaveBeenCalledTimes(1);
    expect(resendButton().disabled).toBe(true);
    expect(resendButton().textContent).toBe("Code sent! Resend code in 60s");
  });

  it("uses the server's retryAfterSeconds and shows its message on cooldown", async () => {
    mockInitOtp.mockRejectedValueOnce(
      new ZeroXKeyRateLimitError(
        "Please wait 42 seconds before requesting another code.",
        ZeroXKeyErrorCodes.OTP_RESEND_COOLDOWN,
        42,
      ),
    );
    renderOtp();
    await advance(60_000);

    await act(async () => resendButton().click());

    expect(mockInitOtp).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "Please wait 42 seconds before requesting another code.",
    );
    expect(resendButton().disabled).toBe(true);
    expect(resendButton().textContent).toBe("Resend code in 42s");
  });
});

describe("EmailInput", () => {
  function typeEmail(value: string) {
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="email-input"]',
    )!;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setValue.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  }

  it("submits once while a request is in flight and shows a cooldown message", async () => {
    let reject!: (error: unknown) => void;
    const onContinue = jest.fn(
      () =>
        new Promise<void>((_resolve, onReject) => {
          reject = onReject;
        }),
    );
    act(() => {
      root.render(<EmailInput onContinue={onContinue} />);
    });
    const input = typeEmail("a@example.test");
    const button = container.querySelector("button")!;

    await act(async () => {
      button.click();
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      button.click();
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);

    await act(async () => {
      reject(
        new ZeroXKeyRateLimitError(
          "Please wait 30 seconds before requesting another code.",
          ZeroXKeyErrorCodes.OTP_RESEND_COOLDOWN,
          30,
        ),
      );
    });
    expect(container.textContent).toContain(
      "Please wait 30 seconds before requesting another code.",
    );
    expect(button.disabled).toBe(false);
  });
});
