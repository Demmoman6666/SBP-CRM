// app/reports/vendor-spend/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Rep = { id: string; name: string };

type ReportRow = {
  customerId: string;
  salonName: string;
  customerName: string | null;
  salesRep: string | null;
  currency: string | null;
  byVendor: Record<string, number>;
  grandTotal: number;
};

type ReportData = {
  vendors: string[];
  customers: ReportRow[];
};

function fmtMoney(n: number | null | undefined, ccy?: string | null) {
  const v = typeof n === "number" ? n : 0;
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy || "GBP" }).format(v); }
  catch { return (ccy || "£") + v.toFixed(2); }
}

export default function VendorSpendReport() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [allVendors, setAllVendors] = useState<string[]>([]);
  const [selectedRep, setSelectedRep] = useState<string>("");
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);

  // Load reps
  useEffect(() => {
    fetch("/api/sales-reps").then(r => r.json()).then(setReps).catch(() => setReps([]));
  }, []);

  // Load a distinct vendor list (from order line items). We reuse the same report API with no filters to get vendor universe.
  useEffect(() => {
    fetch("/api/reports/vendor-spend")
      .then(r => r.json())
      .then((j: ReportData) => setAllVendors(j.vendors || []))
      .catch(() => setAllVendors([]));
  }, []);

  function toggleVendor(v: string) {
    setSelectedVendors(prev =>
      prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
    );
  }

  async function run() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedRep) params.set("rep", selectedRep);
      if (selectedVendors.length) params.set("vendors", selectedVendors.join(","));
      // you can also add from/to here, e.g. params.set("from","2025-01-01")

      const res = await fetch(`/api/reports/vendor-spend?${params.toString()}`, { cache: "no-store" });
      const j: ReportData = await res.json();
      setReport(j);
    } catch (e) {
      console.error(e);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  const vendorsToShow = useMemo(
    () => (selectedVendors.length ? selectedVendors : report?.vendors || []),
    [selectedVendors, report]
  );

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Vendor Spend Report</h1>
        <p className="small">Filter customers by Sales Rep and see spend per vendor.</p>
      </section>

      <section className="card grid" style={{ gap: 12 }}>
        <div className="grid grid-3">
          <div className="field">
            <label>Sales Rep</label>
            <select value={selectedRep} onChange={e => setSelectedRep(e.target.value)}>
              <option value="">— All reps —</option>
              {reps.map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Vendors (multi-select)</label>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {allVendors.map(v => (
                <label key={v} className="small row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={selectedVendors.includes(v)}
                    onChange={() => toggleVendor(v)}
                  />
                  {v}
                </label>
              ))}
            </div>
            <div className="form-hint">Leave empty for all vendors.</div>
          </div>

          <div className="field">
            <label>&nbsp;</label>
            <button className="primary" type="button" onClick={run} disabled={loading}>
              {loading ? "Running…" : "Run Report"}
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        {!report ? (
          <p className="small">Run the report to see results.</p>
        ) : report.customers.length === 0 ? (
          <p className="small">No results.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <div className="row" style={{ fontWeight: 600, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
              <div style={{ flex: "0 0 260px" }}>Customer</div>
              <div style={{ flex: "0 0 160px" }}>Sales Rep</div>
              {vendorsToShow.map(v => (
                <div key={v} style={{ flex: "0 0 140px" }}>{v}</div>
              ))}
              <div style={{ flex: "0 0 140px" }}>Total</div>
            </div>

            {report.customers.map((c) => (
              <div key={c.customerId} className="row" style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                <div style={{ flex: "0 0 260px" }}>
                  <div>{c.salonName}</div>
                  <div className="small muted">{c.customerName || "—"}</div>
                </div>
                <div style={{ flex: "0 0 160px" }}>{c.salesRep || "—"}</div>
                {vendorsToShow.map(v => (
                  <div key={v} style={{ flex: "0 0 140px" }}>
                    {fmtMoney(c.byVendor[v] || 0, c.currency)}
                  </div>
                ))}
                <div style={{ flex: "0 0 140px", fontWeight: 600 }}>
                  {fmtMoney(c.grandTotal, c.currency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
