// app/reports/customers/gap-analysis/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  customerId: string;
  salonName: string;
  customerName: string;
  salesRep: string | null;
  currency: string | null;
  subtotal?: number | null;
  taxes?: number | null;
  total?: number | null;
  // optional vendor breakdown (if your API returns it)
  byVendor?: Record<string, number>;
};

type Rep = { id: string; name: string };
type Brand = { id: string; name: string };

export default function GapAnalysisPage() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [vendors, setVendors] = useState<Brand[]>([]);
  const [selectedReps, setSelectedReps] = useState<string[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // options
  useEffect(() => {
    fetch("/api/sales-reps").then(r => r.json()).then(setReps).catch(() => setReps([]));
    fetch("/api/stocked-brands").then(r => r.json()).then(setVendors).catch(() => setVendors([]));
  }, []);

  function toggle<T extends string>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
  }

  const vendorColumns = useMemo(() => {
    // use selected if any; otherwise derive from first row’s byVendor keys
    if (selectedVendors.length) return selectedVendors;
    const first = rows.find(r => r.byVendor && Object.keys(r.byVendor).length);
    return first ? Object.keys(first.byVendor!) : [];
  }, [rows, selectedVendors]);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (selectedReps.length) params.set("reps", selectedReps.join(","));
      if (selectedVendors.length) params.set("vendors", selectedVendors.join(","));

      const res = await fetch(`/api/reports/vendor-spend?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRows(Array.isArray(data?.rows) ? data.rows : data);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  function fmtMoney(n?: number | null, currency?: string | null) {
    if (n == null) return "—";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "GBP",
        currencyDisplay: "narrowSymbol",
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return n.toFixed(2);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>GAP Analysis</h1>
        <p className="small">
          See spend by vendor per customer. Filter by sales rep, vendor, and date range.
        </p>
      </section>

      {/* Filters */}
      <section className="card grid" style={{ gap: 12 }}>
        <div className="grid grid-3" style={{ gap: 12 }}>
          <div className="field">
            <label>From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button className="primary" type="button" onClick={run} disabled={loading}>
              {loading ? "Loading…" : "Run"}
            </button>
          </div>
        </div>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label>Sales Reps</label>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {reps.map(r => (
                <label key={r.id} className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={selectedReps.includes(r.name)}
                    onChange={() => setSelectedReps(prev => toggle(prev, r.name))}
                  />
                  <span className="small">{r.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Vendors</label>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {vendors.map(v => (
                <label key={v.id} className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={selectedVendors.includes(v.name)}
                    onChange={() => setSelectedVendors(prev => toggle(prev, v.name))}
                  />
                  <span className="small">{v.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
      </section>

      {/* Results */}
      <section className="card">
        <div className="row" style={{ fontWeight: 600, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
          <div style={{ flex: "0 0 260px" }}>Customer</div>
          <div style={{ flex: "0 0 160px" }}>Sales Rep</div>
          {/* dynamic vendor columns */}
          {vendorColumns.map(v => (
            <div key={v} style={{ flex: "0 0 160px" }}>{v}</div>
          ))}
          <div style={{ flex: "0 0 140px" }}>Subtotal</div>
          <div style={{ flex: "0 0 120px" }}>Taxes</div>
          <div style={{ flex: "0 0 140px" }}>Total</div>
        </div>

        {rows.length === 0 ? (
          <p className="small" style={{ marginTop: 10 }}>
            {loading ? "Loading…" : "No data yet. Pick filters and click Run."}
          </p>
        ) : (
          rows.map((r) => (
            <div key={r.customerId} className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: "0 0 260px" }}>
                <div>{r.salonName || r.customerName}</div>
                <div className="small muted">{r.customerName}</div>
              </div>
              <div style={{ flex: "0 0 160px" }}>{r.salesRep || "—"}</div>

              {vendorColumns.map(v => {
                const val = r.byVendor?.[v] ?? null;
                return (
                  <div key={v} style={{ flex: "0 0 160px" }}>
                    {fmtMoney(val, r.currency)}
                  </div>
                );
              })}

              <div style={{ flex: "0 0 140px" }}>{fmtMoney(r.subtotal ?? null, r.currency)}</div>
              <div style={{ flex: "0 0 120px" }}>{fmtMoney(r.taxes ?? null, r.currency)}</div>
              <div style={{ flex: "0 0 140px", fontWeight: 600 }}>{fmtMoney(r.total ?? null, r.currency)}</div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
