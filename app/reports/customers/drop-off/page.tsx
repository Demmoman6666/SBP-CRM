"use client";

import { useEffect, useMemo, useState } from "react";

type Rep = { id: string; name: string };
type Row = {
  customerId: string;
  salonName: string;
  customerName: string | null;
  salesRep: string | null;
  lastOrderAt: string | null; // ISO
  daysSince: number; // Infinity if never ordered
};
type Resp = {
  asOf: string;
  days: number;
  total: number;
  rows: Row[];
};

function dropoffCsvHref({
  bucket,
  days,
  selectedReps,
}: {
  bucket?: string | null;
  days?: number | null;
  selectedReps: string[];
}) {
  const qs = new URLSearchParams();
  if (bucket) qs.set("bucket", bucket);
  if (typeof days === "number") qs.set("days", String(days));
  if (selectedReps?.length) qs.set("reps", selectedReps.join(","));
  qs.set("format", "csv");
  return `/api/reports/customer-dropoff?${qs.toString()}`;
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB");
}

export default function CustomerDropOffPage() {
  /* filters */
  const [reps, setReps] = useState<Rep[]>([]);
  const [selectedReps, setSelectedReps] = useState<string[]>([]);

  const [bucket, setBucket] = useState<"7" | "14" | "21" | "28" | "custom">("7");
  const [customDays, setCustomDays] = useState<number>(35);

  /* dropdown UI state */
  const [repOpen, setRepOpen] = useState(false);

  /* data */
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);

  const days = bucket === "custom" ? customDays : Number(bucket);

  useEffect(() => {
    fetch("/api/sales-reps")
      .then((r) => r.json())
      .then((arr) => setReps(Array.isArray(arr) ? arr : []))
      .catch(() => setReps([]));
  }, []);

  async function run() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (bucket) qs.set("bucket", bucket);
      if (bucket === "custom") qs.set("days", String(customDays));
      if (selectedReps.length) qs.set("reps", selectedReps.join(","));
      const res = await fetch(`/api/reports/customer-dropoff?${qs.toString()}`);
      const json = (await res.json()) as Resp;
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  const csvHref = useMemo(
    () => dropoffCsvHref({ bucket, days, selectedReps }),
    [bucket, days, selectedReps]
  );

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <h1>Customer Drop-Off</h1>
            <p className="small">Customers who haven’t ordered in the selected time window.</p>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {/* Bucket */}
            <div className="field">
              <label>Window</label>
              <select
                value={bucket}
                onChange={(e) => setBucket(e.target.value as any)}
                style={{ minWidth: 160 }}
              >
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="21">Last 21 days</option>
                <option value="28">Last 28 days</option>
                <option value="custom">Custom…</option>
              </select>
            </div>

            {bucket === "custom" && (
              <div className="field">
                <label>Days</label>
                <input
                  type="number"
                  min={1}
                  value={customDays}
                  onChange={(e) => setCustomDays(Math.max(1, Number(e.target.value || 1)))}
                  style={{ width: 100 }}
                />
              </div>
            )}

            {/* Sales rep multi-select dropdown */}
            <div className="field" style={{ position: "relative" }}>
              <label>Sales Reps</label>
              <button
                type="button"
                className="secondary"
                onClick={() => setRepOpen((v) => !v)}
                style={{ minWidth: 220, textAlign: "left" }}
              >
                {selectedReps.length
                  ? `${selectedReps.length} selected`
                  : "Select reps…"}
              </button>

              {repOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    zIndex: 50,
                    background: "white",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 8,
                    maxHeight: 240,
                    overflowY: "auto",
                    boxShadow: "0 6px 24px rgba(0,0,0,0.1)",
                  }}
                >
                  {reps.length === 0 ? (
                    <div className="small muted" style={{ padding: 8 }}>
                      No reps.
                    </div>
                  ) : (
                    reps.map((r) => {
                      const checked = selectedReps.includes(r.name);
                      return (
                        <label
                          key={r.id}
                          className="row"
                          style={{
                            gap: 8,
                            alignItems: "center",
                            padding: "6px 4px",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedReps((prev) => [...prev, r.name]);
                              } else {
                                setSelectedReps((prev) => prev.filter((x) => x !== r.name));
                              }
                            }}
                          />
                          <span>{r.name}</span>
                        </label>
                      );
                    })
                  )}

                  <div className="row" style={{ gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedReps([]);
                      }}
                    >
                      Clear
                    </button>
                    <button type="button" className="primary" onClick={() => setRepOpen(false)}>
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="row" style={{ alignItems: "flex-end", gap: 8 }}>
              <button className="primary" onClick={run} disabled={loading}>
                {loading ? "Loading…" : "Run"}
              </button>
              <a href={csvHref} className="primary" target="_blank" rel="noopener">
                Export CSV
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="card">
        {!data ? (
          <p className="small">Choose filters and click <b>Run</b>.</p>
        ) : data.rows.length === 0 ? (
          <p className="small">Everyone’s active within the last {data.days} days — nice!</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                    Customer
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                    Sales Rep
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                    Last Order
                  </th>
                  <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                    Days Since
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.customerId}>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      {r.salonName}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      {r.salesRep || "—"}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      {fmtDate(r.lastOrderAt)}
                    </td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      {r.daysSince === Number.POSITIVE_INFINITY ? "Never" : r.daysSince}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
