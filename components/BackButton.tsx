"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

export default function BackButton({
  className = "btn",
  label = "Back",
  fallback = "/",
}: {
  className?: string;
  label?: string;
  /** where to go if there's no history to go back to */
  fallback?: string;
}) {
  const router = useRouter();

  const goBack = useCallback(() => {
    // If we have history, go back, otherwise go to a sensible page
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallback);
    }
  }, [router, fallback]);

  return (
    <button
      type="button"
      onClick={goBack}
      className={className}
      aria-label="Go back"
      data-testid="back-button"
      title="Go back"
    >
      ← {label}
    </button>
  );
}
