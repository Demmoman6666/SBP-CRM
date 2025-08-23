// components/CustomerPicker.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Customer = {
  id: string;
  salonName: string;
  customerName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  town: string | null;
  county: string | null;
  postCode: string | null;
};

export default function CustomerPicker({
  name = "customerId",
  required = true,
  label = "Customer",
}: {
  name?: string;
  required?: boolean;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const fetchCtrl = useRef<AbortController | null>(null);

  // Fetch customers as you type (server must support `?search=`)
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSelected(null);
      return;
    }

    const controller = new AbortController();
    fetchCtrl.current?.abort();
    fetchCtrl.current = controller;

    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?search=${encodeURIComponent(q)}`, {
          signal: controller.signal,
          headers: { "accept": "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as Customer[];
          setResults(data);
        }
      } catch {
        /* ignore */
      }
    }, 200); // small debounce

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  // Build a label for each customer for the datalist
  const options = useMemo(
    () =>
      results.map((c) => ({
        value: `${c.salonName} — ${c.customerName}`,
        key: c.id,
        c,
      })),
    [results]
  );

  // When user leaves the field, snap to a matching option (if any)
  function onBlur() {
    const match = options.find((o) => o.value.toLowerCase() === query.trim().toLowerCase());
    if (match) {
      setSelected(match.c);
      setQuery(match.value);
    } else {
      // if the user typed something that doesn't match, clear selection
      setSelected(null);
    }
  }

  return (
    <div>
      <label>{label} {required ? "*" : ""}</label>
      <input
        list="customer-picker-list"
        placeholder="Search by salon, person, email, town…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={onBlur}
        required={required}
      />
      <datalist id="customer-picker-list">
        {options.map((o) => (
          <option key={o.key} value={o.value} />
        ))}
      </datalist>

      {/* Hidden field that actually posts the chosen id */}
      <input type="hidden" name={name} value={selected?.id ?? ""} />

      {/* Address preview */}
      {selected && (
        <div className="small" style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{selected.salonName}</div>
          <div>{selected.addressLine1 || "-"}</div>
          {selected.addressLine2 ? <div>{selected.addressLine2}</div> : null}
          <div>
            {[selected.town, selected.county, selected.postCode].filter(Boolean).join(", ") || "-"}
          </div>
        </div>
      )}

      {/* Helper */}
      {!selected && (
        <div className="form-hint" style={{ marginTop: 6 }}>
          Pick a suggestion so we capture the correct account.
        </div>
      )}
    </div>
  );
}
