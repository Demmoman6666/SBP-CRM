"use client";

import { useEffect, useMemo, useState } from "react";

/* ---------------- types ---------------- */
type VendorSpendRow = {
  customerId: string;
  salonName: string;
  salesRep: string | null;
  perVendor: Record<string, number>;
  subtotal: number;
  taxes: number;
  total: number;
};
type VendorSpendResp = {
  vendors: string[];
  rows: VendorSpendRow[];
};

type Rep = { id: string; name: string };

/* ----------- helpers ----------- */
function fmtMoney(n?: number, currency = "GBP") {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(v);
}
function vendorSpendCsvHref({
  start,
  end,
  selectedReps,
  selectedVendors,
}: {
  start?: string | null;
  end?: string | null;
  selectedReps: string[];
  selectedVendors: string[];
}) {
  const qs = new URLSearchParams();
  if (start) qs.set("start", start);
  if (end) qs.set("end", end);
  if (selectedReps?.length) qs.set("reps", selectedReps.join(","));
  if (selectedVendors?.length) qs.set("vendors", selectedVendors.join(","));
  qs.set("format", "csv");
  return `/api/reports/vendor-spend?${qs.toString()}`;
}

export default function GapAnalysisPage() {
  /* ---------- filters ---------- */
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);

  const [reps, setReps] = useState<Rep[]>([]);
  const [allVendors, setAllVendors] = useState<string[]>([]);

  const [selectedReps, setSelectedReps] = useState<string[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);

  /* ---------- data ---------- */
  const [data, setData] = useState<VendorSpendResp | null>(null);
  const [loading, setLoading] = useState(false);

  /* ---------- bootstrap ---------- */
  useEffect(() => {
    (async () => {
      try {
        const [repsRes, vendorsRes] = await Promise.all([
          fetch("/api/sales-reps").then((r) => r.json()).catch(() => []),
          fetch("/api/stocked-brands").then((r) => r.json()).catch(() => ({ vendors: [] })),
        ]);
        setReps(Array.isArray(repsRes) ? repsRes : []);
        setAllVendors(Array.isArray(vendorsRes?.vendors) ? vendorsRes.vendors : []);
      } catch {
        setReps([]);
        setAllVendors([]);
      }
    })();
  }, []);

  /* ---------- query ---------- */
  async function run() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (start) qs.set("start", start);
      if (end) qs.set("end", end);
      if (selectedReps.length) qs.set("reps", selectedReps.join(","));
      if (selectedVendors.length) qs.set("vendors", selectedVendors.join(","));

      const res = await fetch(`/api/reports/vendor-spend?${qs.toString()}`);
      const json = (await res.json()) as VendorSpendResp;
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  /* ---------- totals row ---------- */
  const totals = useMemo(() => {
    if (!data) return null;
    const byVendor: Record<string, number> = {};
    let subtotal = 0,
      taxes = 0,
      total = 0;

    for (const r of data.rows) {
      subtotal += r.subtotal || 0;
      taxes += r.taxes || 0;
      total += r.total || 0;
      for (const v of data.vendors) {
        byVendor[v] = (byVendor[v] || 0) + (r.perVendor[v] || 0);
      }
    }
    return { byVendor, subtotal, taxes, total };
  }, [data]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <h1>GAP Analysis</h1>
            <p className="small">Spend by customer & vendor, filterable by Sales Rep.</p>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {/* Date range */}
            <div className="field">
              <label>Start</label>
              <input type="date" value={start ?? ""} onChange={(e) => setStart(e.target.value || null)} />
            </div>
            <div className="field">
              <label>End</label>
              <input type="date" value={end ?? ""} onChange={(e) => setEnd(e.target.value || null)} />
            </div>

            {/* Reps multi-select */}
            <div className="field">
              <label>Sales Reps</label>
              <select
                multiple
                value={selectedReps}
                onChange={(e) =>
                  setSelectedReps(Array.from(e.target.selectedOptions).map((o) => o.value))
                }
                style={{ minWidth: 180, height: 72 }}
              >
                {reps.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
              <div className="form-hint">Hold Ctrl / Cmd to multi-select</div>
            </div>

            {/* Vendors multi-select */}
            <div className="field">
              <label>Vendors</label>
              <select
                multiple
                value={selectedVendors}
                onChange={(e) =>
                  setSelectedVendors(Array.from(e.target.selectedOptions).map((o) => o.value))
                }
                style={{ minWidth: 220, height: 100 }}
              >
                {allVendors.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <div className="form-hint">Leave empty to include all</div>
            </div>

            <div className="row" style={{ alignItems: "flex-end", gap: 8 }}>
              <button className="primary" onClick={run} disabled={loading}>
                {loading ? "Loading…" : "Run"}
              </button>
              <a
                href={vendorSpendCsvHref({ start, end, selectedReps, selectedVendors })}
                className="primary"
                target="_blank"
                rel="noopener"
              >
                Export CSV
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="card">
        {!data ? (
          <p className="small">Set filters and click <b>Run</b>.</p>
        ) : data.rows.length === 0 ? (
          <p className="small">No results.</p>
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
                  {data.vendors.map((v) => (
                    <th
                      key={v}
                      style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}
                    >
                      {v}
                    </th>
                  ))}
                  <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                    Subtotal
                  </th>
                  <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                    Taxes
                  </th>
                  <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.customerId}>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>{r.salonName}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      {r.salesRep || "—"}
                    </td>
                    {data.vendors.map((v) => (
                      <td
                        key={v}
                        style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}
                      >
                        {fmtMoney(r.perVendor[v])}
                      </td>
                    ))}
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      {fmtMoney(r.subtotal)}
                    </td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      {fmtMoney(r.taxes)}
                    </td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      {fmtMoney(r.total)}
                    </td>
                  </tr>
                ))}

                {totals && (
                  <tr>
                    <td colSpan={2} style={{ padding: "8px", fontWeight: 600 }}>
                      Totals
                    </td>
                    {data.vendors.map((v) => (
                      <td key={v} style={{ textAlign: "right", padding: "8px", fontWeight: 600 }}>
                        {fmtMoney(totals.byVendor[v])}
                      </td>
                    ))}
                    <td style={{ textAlign: "right", padding: "8px", fontWeight: 600 }}>
                      {fmtMoney(totals.subtotal)}
                    </td>
                    <td style={{ textAlign: "right", padding: "8px", fontWeight: 600 }}>
                      {fmtMoney(totals.taxes)}
                    </td>
                    <td style={{ textAlign: "right", padding: "8px", fontWeight: 600 }}>
                      {fmtMoney(totals.total)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
