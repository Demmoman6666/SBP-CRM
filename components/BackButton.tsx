// components/BackButton.tsx
"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

type Props = {
  /** Text shown on the button (default: "Back") */
  label?: string;
  /** Class names for styling (e.g. "btn") */
  className?: string;
  /** Where to go if there’s no browser history (default: "/") */
  fallback?: string;
  /** Optional aria-label override */
  ariaLabel?: string;
};

export default function BackButton({
  label = "Back",
  className,
  fallback = "/",
  ariaLabel,
}: Props) {
  const router = useRouter();

  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      // if there’s history, go back; otherwise push fallback
      if (typeof window !== "undefined" && window.history.length > 1) {
        router.back();
      } else {
        router.push(fallback);
      }
    },
    [router, fallback]
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      aria-label={ariaLabel || label}
    >
      {label}
    </button>
  );
}
