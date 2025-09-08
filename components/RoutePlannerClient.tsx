// components/RoutePlannerClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Customer = {
  id: string;
  salonName: string;
  customerName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  town: string | null;
  county: string | null;
  postCode: string | null;
  country: string | null;
  customerEmailAddress: string | null;
  customerNumber: string | null;
  salesRep: string | null;
  createdAt: string;
  // optional extras (API may return them; not required to render)
  daysOpen?: string | null;
  openingHours?: string | null;
};

const DOW: Array<"Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"> = [
  "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
];

export default function RoutePlannerClient({ reps }: { reps: string[] }) {
  const [selectedReps, setSelectedReps] = useState<string[]>([]);
  const [pcInput, setPcInput] = useState("");
  const [selectedDays, setSelectedDays] = useState<string[]>([]); // NEW
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Customer[]>([]);

  const pcs = useMemo(
    () =>
      pcInput
        .split(/[,\s]+/)
        .map(s => s.trim().toUpperCase())
        .filter(Boolean),
    [pcInput]
  );

  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedReps.length) params.set("reps", selectedReps.join(","));
    if (pcs.length) params.set("pc", pcs.join(","));
    if (selectedDays.length) params.set("days", selectedDays.join(",")); // NEW
    return params.toString();
  }, [selectedReps, pcs, selectedDays]);

  async function runSearch() {
    setLoading(true);
    try {
      const r = await fetch(`/api/route-planning?${qs}`, { cache: "no-store" });
      if (r.ok) setRows(await r.json());
      else setRows([]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  function toggleRep(rep: string) {
    setSelectedReps(prev =>
      prev.includes(rep) ? prev.filter(r => r !== rep) : [...prev, rep]
    );
  }

  function toggleDay(day: string) {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  }

  function copyAddresses() {
    const lines = rows.map(r => {
      const parts = [
        r.salonName,
        r.addressLine1,
        r.addressLine2 || "",
        r.town || "",
        r.county || "",
        r.postCode || "",
        r.country || "UK",
      ]
        .filter(Boolean)
        .join(", ");
      return parts;
    });
    navigator.clipboard.writeText(lines.join("\n"));
    alert(`Copied ${lines.length} address${lines.length === 1 ? "" : "es"} to clipboard.`);
  }

  function exportCSV() {
    const header = [
      "Salon",
      "Contact",
      "Address 1",
      "Address 2",
      "Town",
      "County",
      "Postcode",
      "Country",
      "Phone",
      "Email",
      "Sales Rep",
    ];
    const body = rows.map(r => [
      r.salonName,
      r.customerName || "",
      r.addressLine1,
      r.addressLine2 || "",
      r.town || "",
      r.county || "",
      r.postCode || "",
      r.country || "UK",
      r.customerNumber || "",
      r.customerEmailAddress || "",
      r.salesRep || "",
    ]);
    const csv = [header, ...body]
      .map(cols =>
        cols
          .map(v => {
            const s = String(v ?? "");
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "route-planner.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Filters</h2>

      {/* Filters row */}
      <div className="row" style={{ flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
        {/* Sales Reps */}
        <div className="field" style={{ minWidth: 260 }}>
          <label>Sales Reps</label>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {!reps.length && <span className="small">No reps found</span>}
            {reps.map(rep => (
              <label key={rep} className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: 999, padding: "6px 10px", background: selectedReps.includes(rep) ? "#111" : "#fff", color: selectedReps.includes(rep) ? "#fff" : "inherit", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  className="hidden"
                  checked={selectedReps.includes(rep)}
                  onChange={() => toggleRep(rep)}
                />
                {rep}
              </label>
            ))}
          </div>
          <div className="form-hint">Click to toggle (multi-select).</div>
        </div>

        {/* Postcode prefixes */}
        <div className="field" style={{ minWidth: 280, flex: "1 1 auto" }}>
          <label>Postcode prefixes</label>
          <input
            type="text"
            placeholder="e.g. IP1, IP14, CF8, CF43"
            value={pcInput}
            onChange={(e) => setPcInput(e.target.value)}
          />
          <div className="form-hint">Comma or space separated. Matches start of the postcode.</div>
        </div>

        {/* NEW: Days Open */}
        <div className="field" style={{ minWidth: 320 }}>
          <label>Days Open</label>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {DOW.map(d => {
              const active = selectedDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className="small"
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    padding: "6px 10px",
                    background: active ? "#111" : "#fff",
                    color: active ? "#fff" : "inherit",
                    cursor: "pointer",
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="form-hint">Shows salons open on <b>any</b> of the selected days.</div>
        </div>

        {/* Manual search button */}
        <div>
          <button className="primary" onClick={runSearch} disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {/* Results */}
      <div style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Results</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={copyAddresses} disabled={!rows.length}>Copy addresses</button>
            <button className="btn" onClick={exportCSV} disabled={!rows.length}>Export CSV</button>
          </div>
        </div>

        {!rows.length ? (
          <p className="small" style={{ marginTop: 12 }}>{loading ? "Loading…" : "No matches found."}</p>
        ) : (
          <div className="table" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Salon</th>
                  <th>Contact</th>
                  <th>Town</th>
                  <th>Postcode</th>
                  <th>Sales Rep</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small" style={{ maxWidth: 260, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                      {r.salonName}
                      <div className="small" style={{ color: "var(--muted)" }}>
                        {r.addressLine1}{r.addressLine2 ? `, ${r.addressLine2}` : ""}{r.town ? `, ${r.town}` : ""}{r.county ? `, ${r.county}` : ""}{r.postCode ? `, ${r.postCode}` : ""}{r.country ? `, ${r.country}` : ""}
                      </div>
                    </td>
                    <td className="small">{r.customerName || "—"}</td>
                    <td className="small">{r.town || "—"}</td>
                    <td className="small">{r.postCode || "—"}</td>
                    <td className="small">{r.salesRep || "—"}</td>
                    <td className="small right">
                      <Link href={`/customers/${r.id}`} className="btn small">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
