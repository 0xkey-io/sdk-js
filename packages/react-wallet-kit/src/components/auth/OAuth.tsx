import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ActionButton } from "../design/Buttons";

interface OAuthButtonProps {
  name: string;
  icon: React.ReactNode;
  onClick: () => void;
  className?: string;
  /** Compact square icon button (auth modal social row) */
  iconOnly?: boolean;
  "aria-label"?: string;
}

export function OAuthButton(props: OAuthButtonProps) {
  const {
    name,
    icon,
    onClick,
    className,
    iconOnly = false,
    "aria-label": ariaLabel,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    if (iconOnly) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = entry.contentRect.width;
      setShowText(width > 300);
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [iconOnly]);

  const testId = `oauth-${name.toLowerCase().replace(/\s+/g, "-")}`;

  if (iconOnly) {
    return (
      <ActionButton
        onClick={onClick}
        name={testId}
        aria-label={ariaLabel ?? `Continue with ${name}`}
        className={clsx(
          "flex items-center justify-center shrink-0 max-w-none !w-12 !min-w-12 h-10 p-0 rounded-lg",
          "border border-modal-background-dark/15 bg-button-light text-icon-text-light",
          "dark:border-modal-background-light/20 dark:bg-button-dark dark:text-white",
          className,
        )}
      >
        <span className="flex size-full items-center justify-center [&>svg]:size-5">
          {icon}
        </span>
      </ActionButton>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full">
      <ActionButton
        onClick={onClick}
        name={testId}
        aria-label={ariaLabel ?? `Continue with ${name}`}
        className={clsx(
          "flex items-center justify-center gap-2 w-full h-full rounded-md bg-button-light dark:bg-button-dark text-inherit",
          className,
        )}
      >
        {icon}
        {showText && (
          <span className="truncate">{`Continue with ${name}`}</span>
        )}
      </ActionButton>
    </div>
  );
}
