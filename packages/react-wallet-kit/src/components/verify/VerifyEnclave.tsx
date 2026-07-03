import clsx from "clsx";
import { useModal } from "../../providers/modal/Hook";
import { useEffect, useRef, useState } from "react";
import { Transition, TransitionChild } from "@headlessui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { useZeroXKey } from "../../providers/client/Hook";
import type { HandleVerifyEnclaveParams } from "../../types/method-types";
import { Spinner } from "../design/Spinners";
import { DeveloperError } from "../design/Failure";

type VerifyEnclavePageProps = HandleVerifyEnclaveParams & {
  onSuccess?: (pivotHashHex: string) => void;
  onError?: (error: unknown) => void;
  successPageDuration?: number;
};

/**
 * Verifies that the live enclave running `appName` matches a manifest
 * approved by 0xkey's quorum multi-sig (via `verifyLatestBootProof`).
 *
 * Unlike {@link VerifyPage} (which verifies a specific *operation* via an
 * App Proof), this verifies the *enclave's identity* directly — it doesn't
 * depend on any App Proof having been generated, so it works today for any
 * enclave app that already serves boot proofs.
 *
 * On failure, this shows a visible error state (via {@link DeveloperError})
 * rather than silently closing — since this is meant to be a user-facing
 * trust signal, a failed verification must not be indistinguishable from a
 * cancelled/skipped one.
 */
export function VerifyEnclavePage(props: VerifyEnclavePageProps) {
  const {
    appName,
    organizationId,
    stampWith,
    anchor,
    onSuccess,
    onError,
    successPageDuration,
  } = props;

  const { isMobile, closeModal } = useModal();
  const { verifyLatestBootProof } = useZeroXKey();

  const hasRun = useRef(false);

  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [pivotHashHex, setPivotHashHex] = useState<string>("");
  const [error, setError] = useState<unknown>(undefined);
  const [isTextPinging, setIsTextPinging] = useState(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const closeTimeoutRef = {
      current: undefined as ReturnType<typeof setTimeout> | undefined,
    };

    const runAction = async () => {
      try {
        // Slight delay to let the modal animation complete — verification
        // can briefly freeze the UI thread while it runs.
        await new Promise((resolve) => setTimeout(resolve, 300));
        const parsed = await verifyLatestBootProof({
          appName,
          ...(organizationId !== undefined && { organizationId }),
          ...(stampWith && { stampWith }),
          ...(anchor && { anchor }),
        });
        setPivotHashHex(parsed.manifest.pivotHashHex);
        setStatus("success");

        if (!successPageDuration || successPageDuration === 0) {
          onSuccess?.(parsed.manifest.pivotHashHex);
          closeModal();
          return;
        }

        setTimeout(() => setIsTextPinging(true), 500);
        setTimeout(() => setIsTextPinging(false), 1500);

        closeTimeoutRef.current = setTimeout(() => {
          onSuccess?.(parsed.manifest.pivotHashHex);
          closeModal();
        }, successPageDuration);
      } catch (err) {
        setError(err);
        setStatus("error");
        onError?.(err);
      }
    };

    runAction();

    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  if (status === "error") {
    return (
      <div
        className={clsx(
          "flex flex-col items-center justify-center py-5 transition-all duration-300",
          isMobile ? "w-full" : "w-80",
        )}
      >
        <DeveloperError
          developerTitle="Enclave verification failed"
          developerMessages={[
            error instanceof Error ? error.message : String(error),
          ]}
          userTitle="Verification failed"
          userMessages={[
            "We couldn't verify this enclave's identity. Please try again later.",
          ]}
        />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center py-5 transition-all duration-300",
        isMobile ? "w-full" : "w-72",
      )}
    >
      {status === "loading" && (
        <div className="size-full absolute text-center text-lg font-semibold flex flex-row items-center justify-center gap-2">
          <Spinner strokeWidth={2} className="h-full" />
          <span className="animate-pulse">Verifying enclave identity...</span>
        </div>
      )}

      {/* Animation */}
      <div className="relative flex flex-col items-center justify-center size-[88px] overflow-hidden">
        <Transition
          as="div"
          show={status === "success"}
          enter="transition-all duration-600 ease-in-out"
          enterFrom="opacity-0 scale-40"
          enterTo="opacity-100 scale-100"
          className=" absolute size-full flex flex-col items-center justify-center"
        >
          <div className="size-full border-2 border-primary-light dark:border-primary-dark text-primary-light dark:text-primary-dark rounded-full flex flex-col items-center justify-center box-border">
            <TransitionChild
              as="div"
              enter="transition-all duration-200 delay-300 ease-out"
              enterFrom="opacity-0 scale-60"
              enterTo="opacity-100 scale-100"
              className="relative flex flex-col items-center justify-center"
            >
              <FontAwesomeIcon icon={faCheck} size="2x" />
              <FontAwesomeIcon
                className="absolute animate-ping"
                icon={faCheck}
                size="2x"
              />
            </TransitionChild>
          </div>
        </Transition>
      </div>

      {/* Success text */}
      <Transition
        as="div"
        show={status === "success"}
        className="w-full text-center text-lg font-semibold flex flex-col items-center justify-center mt-2 relative"
        enter="transition-all ease-out duration-200 delay-200"
        enterFrom="opacity-0 -translate-y-2"
        enterTo="opacity-100 translate-y-0"
      >
        <span>Verified!</span>

        {isTextPinging && (
          <span className="absolute animate-ping text-icon-text-light dark:text-icon-text-dark">
            Verified!
          </span>
        )}
      </Transition>

      {status === "success" && pivotHashHex && (
        <div className="w-full text-center text-xs mt-3 font-mono text-icon-text-light dark:text-icon-text-dark break-all px-4">
          pivot {pivotHashHex.slice(0, 16)}...
        </div>
      )}
    </div>
  );
}
