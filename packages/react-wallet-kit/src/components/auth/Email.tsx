import { useRef, useState } from "react";
import { Input } from "@headlessui/react";
import { ActionButton, IconButton } from "../design/Buttons";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons";
import clsx from "clsx";
import { useZeroXKey } from "../../providers/client/Hook";
import { getOtpCooldown } from "../../utils/utils";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

interface EmailInputProps {
  onContinue?: (email: string) => void;
}

export function EmailInput(props: EmailInputProps) {
  const { onContinue } = props;
  const { config } = useZeroXKey();
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const useContinueButton = config?.ui?.preferLargeActionButtons ?? false;

  const emailIsValid = isValidEmail(email);

  const handleContinue = async () => {
    if (emailIsValid && onContinue && !loadingRef.current) {
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        await Promise.resolve(onContinue(email));
      } catch (error) {
        const cooldown = getOtpCooldown(error);
        if (!cooldown) throw error;
        setError(cooldown.message);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleContinue();
    }
  };

  const buttonDisabled = !emailIsValid || loading;

  const inlineArrowClass = clsx(
    "absolute right-1.5 !size-8 !rounded-full !border-none !bg-transparent transition-all duration-300 dark:!bg-transparent active:!outline-none",
    emailIsValid
      ? "text-icon-text-light dark:text-white/70"
      : "text-icon-text-light/40 dark:text-white/30",
  );

  const continueButtonClass = clsx(
    "transition-all duration-300",
    (emailIsValid || useContinueButton) &&
      "bg-primary-light dark:bg-primary-dark hover:bg-primary-light/90 dark:hover:bg-primary-dark/90 text-primary-text-light dark:text-primary-text-dark",
  );

  return (
    <>
      <div
        className={clsx(
          "w-full items-center justify-center space-y-3",
          useContinueButton ? "flex flex-col" : "flex flex-row",
        )}
      >
        <div
          className={clsx(
            "w-full",
            !useContinueButton && "relative flex items-center",
          )}
        >
          <Input
            data-testid="email-input"
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            className="box-border h-10 w-full rounded-lg border border-modal-background-dark/15 bg-button-light py-2.5 pl-4 pr-12 text-sm text-inherit placeholder:text-icon-text-light/45 focus:outline-1 focus:outline-offset-0 focus:outline-primary-light dark:border-modal-background-light/20 dark:bg-button-dark dark:text-white dark:placeholder:text-white/35 focus:dark:outline-primary-dark"
          />

          {!useContinueButton && (
            <IconButton
              icon={faArrowRight}
              onClick={handleContinue}
              disabled={buttonDisabled}
              loading={loading}
              name="email-continue-icon"
              className={inlineArrowClass}
              spinnerClassName="text-icon-text-light dark:text-icon-text-dark"
            />
          )}
        </div>

        {useContinueButton && (
          <ActionButton
            onClick={handleContinue}
            disabled={buttonDisabled}
            loading={loading}
            className={clsx("w-full", continueButtonClass)}
            name="email-continue"
            spinnerClassName="text-primary-text-light dark:text-primary-text-dark"
          >
            Continue
          </ActionButton>
        )}
      </div>
      {error && (
        <div className="mt-2 text-red-400 text-center text-sm">{error}</div>
      )}
    </>
  );
}
