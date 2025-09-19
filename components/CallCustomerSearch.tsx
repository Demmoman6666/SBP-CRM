"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Filters visible call rows by customer name.
 * Expects each rendered row to have: data-customer="Customer Name"
 * and the container that holds all rows to have: class="call-rows".
 */
export default function CallCustomerSearch({
  placeholder = "Search customer…",
}: {
  placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const initialQ = (sp.get("q") ?? "").trim();

  const [q, setQ] = React.useState(initialQ);

  // Apply filtering to DOM rows (progressive enhancement)
  const applyFilter = React.useCallback(
    (query: string) => {
      const rows = document.querySelectorAll<HTMLElement>(".call-rows [data-customer]");
      const needle = query.toLowerCase();
      let shown = 0;
      rows.forEach((el) => {
        const hay = (el.getAttribute("data-customer") || "").toLowerCase();
        const match = !needle || hay.includes(needle);
        el.style.display = match ? "" : "none";
        if (match) shown++;
      });
      // Optional: update a count badge if you add one later
      return shown;
    },
    []
  );

  // Run once on mount (so ?q= in the URL filters immediately on reload)
  React.useEffect(() => {
    applyFilter(initialQ);
  }, [initialQ, applyFilter]);

  // Push q to the URL (so it’s shareable) without a full reload
  const syncUrl = React.useCallback(
    (query: string) => {
      const params = new URLSearchParams(sp?.toString());
      if (query) params.set("q", query);
      else params.delete("q");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, sp]
  );

  return (
    <div className="row" style={{ gap: 8, alignItems: "center" }}>
      <input
        type="search"
        inputMode="search"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          applyFilter(v);
          syncUrl(v);
        }}
        style={{ width: 260 }}
      />
      {q ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setQ("");
            applyFilter("");
            syncUrl("");
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
