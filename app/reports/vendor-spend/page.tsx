// app/reports/vendor-spend/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  customerId: string;
  salonName: string;
  customerName: string;
  salesRep: string | null;
  vendor: string | null;
  total: number;
  currency: string | null;
};

type ApiResponse = {
  params: { reps: string[]; vendors: string[]; from: string | null; to: string | null };
  count: number;
  rows: Row[];
  totalsByCustomer: Record<string, number>;
};

type Rep = { id: string; name: string };

function fmtMoney(n: number, c?: string | null) {
  if (!Number.isFinite(n)) n = 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: c || "GBP",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return (c ? `${c} ` : "") + n.toFixed(2);
  }
}

export default function VendorSpendReportPage() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);

  // filters
  const [repSel, setRepSel] = useState<string[]>([]);
  const [vendorSel, setVendorSel] = useState<string[]>([]);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  useEffect(() => {
    fetch("/api/sales-reps").then(r => r.json()).then(setReps).catch(() => setReps([]));
    fetch("/api/vendors").then(r => r.json()).then(setVendors).catch(() => setVendors([]));
  }, []);

  async function run() {
    const sp = new URLSearchParams();
    if (repSel.length) sp.set("reps", repSel.join(","));
    if (vendorSel.length) sp.set("vendors", vendorSel.join(","));
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);

    setLoading(true);
    try {
      const res = await fetch(`/api/reports/vendor-spend?${sp.toString()}`, { cache: "no-store" });
      const json: ApiResponse = await res.json();
      setRows(json.rows || []);
    } finally {
      setLoading(false);
    }
  }

  const grandTotal = useMemo(
    () => rows.reduce((acc, r) => acc + (Number.isFinite(r.total) ? r.total : 0), 0),
    [rows]
  );
  const currency = rows[0]?.currency || "GBP";

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Vendor Spend</h1>
        <p className="small">Filter customers by Sales Rep and Vendor, then view spend totals.</p>
      </section>

      <section className="card grid" style={{ gap: 12 }}>
        <div className="grid grid-3">
          <div className="field">
            <label>Sales Reps</label>
            <select
              multiple
              value={repSel}
              onChange={(e) =>
                setRepSel(Array.from(e.target.selectedOptions).map((o) => o.value))
              }
            >
              {reps.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
            <div className="form-hint">Hold Ctrl/Cmd to select multiple.</div>
          </div>

          <div className="field">
            <label>Vendors</label>
            <select
              multiple
              value={vendorSel}
              onChange={(e) =>
                setVendorSel(Array.from(e.target.selectedOptions).map((o) => o.value))
              }
            >
              {vendors.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <div className="form-hint">Hold Ctrl/Cmd to select multiple.</div>
          </div>

          <div className="grid" style={{ gap: 8 }}>
            <div className="field">
              <label>From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="right">
          <button className="primary" onClick={run} disabled={loading}>
            {loading ? "Loading…" : "Run Report"}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <b>Results ({rows.length})</b>
          <b>Total: {fmtMoney(grandTotal, currency)}</b>
        </div>

        {rows.length === 0 ? (
          <p className="small">No data. Choose filters and click “Run Report”.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1.1fr 1fr 1fr",
              columnGap: 10,
              rowGap: 8,
              fontSize: 14,
            }}
          >
            {/* header */}
            <div className="muted small">Customer</div>
            <div className="muted small">Vendor</div>
            <div className="muted small">Sales Rep</div>
            <div className="muted small" style={{ textAlign: "right" }}>
              Spend
            </div>

            {/* rows */}
            {rows.map((r) => (
              <div key={`${r.customerId}-${r.vendor}`} style={{ display: "contents" }}>
                <div>
                  <a href={`/customers/${r.customerId}`} className="link">
                    {r.salonName || r.customerName || r.customerId}
                  </a>
                </div>
                <div>{r.vendor || "—"}</div>
                <div>{r.salesRep || "—"}</div>
                <div style={{ textAlign: "right", fontWeight: 600 }}>
                  {fmtMoney(r.total, r.currency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
