// app/reports/customers/drop-off/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Row = {
  customerId: string;
  salonName: string;
  customerName: string | null;
  salesRep: string | null;
  lastOrderAt: string | null; // ISO
  daysSince: number;          // Infinity if never
};

type ApiResponse = {
  asOf: string;
  days: number;
  total: number;
  rows: Row[];
};

type Rep = { id: string; name: string };

function fmtDate(iso?: string | null) {
  if (!iso) return "— Never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

export default function CustomerDropOffPage() {
  // Sales reps for filter
  const [reps, setReps] = useState<Rep[]>([]);
  const [selectedReps, setSelectedReps] = useState<string[]>([]);

  // Period controls
  const [bucket, setBucket] = useState<"7" | "14" | "21" | "28" | "custom">("7");
  const [customDays, setCustomDays] = useState<number>(30);

  // Data
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch reps on mount
  useEffect(() => {
    fetch("/api/sales-reps")
      .then(r => r.json())
      .then((arr: Rep[]) => setReps(arr))
      .catch(() => setReps([]));
  }, []);

  const daysParam = useMemo(() => {
    if (bucket === "custom") return Math.max(1, Math.floor(customDays || 1));
    return Number(bucket);
  }, [bucket, customDays]);

  const queryAndLoad = async () => {
    setLoading(true);
    try {
      const qp = new URLSearchParams();
      qp.set("bucket", bucket);
      qp.set("days", String(daysParam));
      if (selectedReps.length) qp.set("reps", selectedReps.join(","));
      const res = await fetch(`/api/reports/customer-dropoff?${qp.toString()}`);
      const json: ApiResponse = await res.json();
      setData(json);
    } catch {
      setData({ asOf: new Date().toISOString(), days: daysParam, total: 0, rows: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queryAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // initial

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    queryAndLoad();
  };

  // Group rows by salesRep
  const groups = useMemo(() => {
    const g = new Map<string, Row[]>();
    if (!data) return g;
    for (const r of data.rows) {
      const key = r.salesRep || "Unassigned";
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(r);
    }
    // sort within groups by daysSince desc
    for (const key of g.keys()) {
      g.get(key)!.sort((a, b) => b.daysSince - a.daysSince);
    }
    return g;
  }, [data]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Customer Drop-off</h1>
        <p className="small">
          See which customers <b>haven't placed an order</b> within the selected window.
        </p>
      </section>

      {/* Filters */}
      <section className="card">
        <form onSubmit={onApply} className="grid" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            <div className="field">
              <label>Period</label>
              <div className="row" style={{ gap: 10 }}>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="radio"
                    name="bucket"
                    value="7"
                    checked={bucket === "7"}
                    onChange={() => setBucket("7")}
                  />
                  1 week
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="radio"
                    name="bucket"
                    value="14"
                    checked={bucket === "14"}
                    onChange={() => setBucket("14")}
                  />
                  2 weeks
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="radio"
                    name="bucket"
                    value="21"
                    checked={bucket === "21"}
                    onChange={() => setBucket("21")}
                  />
                  3 weeks
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="radio"
                    name="bucket"
                    value="28"
                    checked={bucket === "28"}
                    onChange={() => setBucket("28")}
                  />
                  4 weeks
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="radio"
                    name="bucket"
                    value="custom"
                    checked={bucket === "custom"}
                    onChange={() => setBucket("custom")}
                  />
                  Custom
                </label>
                {bucket === "custom" && (
                  <input
                    type="number"
                    min={1}
                    value={customDays}
                    onChange={e => setCustomDays(Number(e.target.value))}
                    style={{ width: 90 }}
                    aria-label="Custom days"
                  />
                )}
              </div>
            </div>

            <div className="field" style={{ minWidth: 260 }}>
              <label>Sales Reps</label>
              <select
                multiple
                value={selectedReps}
                onChange={e => {
                  const opts = Array.from(e.target.selectedOptions).map(o => o.value);
                  setSelectedReps(opts);
                }}
                size={Math.min(6, Math.max(3, reps.length))}
              >
                {reps.map(r => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
              <div className="form-hint">Hold Cmd/Ctrl to multi-select</div>
            </div>
          </div>

          <div className="right">
            <button className="primary" type="submit" disabled={loading}>
              {loading ? "Loading…" : "Apply Filters"}
            </button>
          </div>
        </form>
      </section>

      {/* Results */}
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <div className="small">
            Window: <b>{daysParam} days</b>
            {data?.asOf && <> • As of {new Date(data.asOf).toLocaleString()}</>}
          </div>
          <div className="small">Total: <b>{data?.total ?? 0}</b></div>
        </div>

        {!data || data.rows.length === 0 ? (
          <p className="small">No customers match the selected criteria.</p>
        ) : (
          Array.from(groups.entries()).map(([rep, rows]) => (
            <div key={rep} style={{ marginBottom: 16 }}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <b>{rep}</b>
                <span className="small">{rows.length} accounts</span>
              </div>

              <div
                className="card"
                style={{
                  padding: 10,
                  border: "1px solid var(--border)",
                  display: "grid",
                  rowGap: 8,
                }}
              >
                {/* header */}
                <div className="row small muted" style={{ fontWeight: 600 }}>
                  <div style={{ flex: "0 0 280px" }}>Customer</div>
                  <div style={{ flex: "0 0 150px" }}>Last order</div>
                  <div style={{ flex: "0 0 110px" }}>Days since</div>
                  <div style={{ flex: "1 1 auto" }}></div>
                </div>

                {rows.map(r => (
                  <div key={r.customerId} className="row" style={{ alignItems: "center" }}>
                    <div style={{ flex: "0 0 280px" }}>
                      <Link href={`/customers/${r.customerId}`} className="link">
                        {r.salonName}
                      </Link>
                      {r.customerName ? (
                        <div className="small muted">{r.customerName}</div>
                      ) : null}
                    </div>
                    <div style={{ flex: "0 0 150px" }}>{fmtDate(r.lastOrderAt)}</div>
                    <div style={{ flex: "0 0 110px" }}>
                      {Number.isFinite(r.daysSince) ? r.daysSince : "∞"}
                    </div>
                    <div style={{ flex: "1 1 auto" }} />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
