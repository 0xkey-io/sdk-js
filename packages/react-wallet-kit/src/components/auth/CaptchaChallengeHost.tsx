import type { RefObject } from "react";

/** An always-mounted container so an active Turnstile widget remains visible. */
export function CaptchaChallengeHost({
  active,
  containerRef,
}: {
  active: boolean;
  containerRef: RefObject<HTMLDivElement>;
}) {
  return (
    <div data-captcha-challenge-host aria-live="polite">
      {active && <p role="status">Complete the security check to continue.</p>}
      <div ref={containerRef} />
    </div>
  );
}
