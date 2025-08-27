// app/reports/customers/gap-analysis/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Rep = { id: string; name: string };

type ApiRow = {
  customerId: string;
  salonName: string;
  salesRep: string | null;
  // depending on your API version this might be perVendor or vendors – support both:
  perVendor?: Record<string, number>;
  vendors?: Record<string, number>;
  subtotal: number;
  taxes: number;
  total: number;
};

type ApiResp = {
  vendors: string[];
  rows: ApiRow[];
};

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const fmtMoney = (n?: number) => (n ? GBP.format(n) : "—");

// date helpers
const pad2 = (n: number) => String(n).padStart(2, "0");
const toDMY = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

function startOfWeekMonday(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay();
  const diff = (dow + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfYear(d: Date) { return new Date(d.getFullYear(), 0, 1); }

export default function GapAnalysisPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // reps
  const [reps, setReps] = useState<Rep[]>([]);
  const [repSel, setRepSel] = useState<string[]>([]);

  // vendors (from StockedBrand)
  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  const [vendorSel, setVendorSel] = useState<string[]>([]);

  // results
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncingVendors, setSyncingVendors] = useState(false);

  // load reps
  useEffect(() => {
    fetch("/api/sales-reps")
      .then((r) => r.json())
      .then((arr: Rep[]) => {
        setReps(arr || []);
        setRepSel((arr || []).map((r) => r.name)); // default: all reps
      })
      .catch(() => setReps([]));
  }, []);

  // load vendors (StockedBrand list)
  async function loadVendors() {
    const res = await fetch("/api/stocked-brands");
    const json = await res.json();
    const list: string[] = (json?.vendors ?? []).filter(Boolean);
    list.sort((a, b) => a.localeCompare(b));
    setVendorOptions(list);
    setVendorSel(list); // default: all selected
  }
  useEffect(() => { loadVendors(); }, []);

  async function run() {
    setLoading(true);
    try {
      const qp = new URLSearchParams();
      // IMPORTANT: the API expects start/end keys
      if (from) qp.set("start", from);
      if (to) qp.set("end", to);
      if (repSel.length) qp.set("reps", repSel.join(","));
      if (vendorSel.length) qp.set("vendors", vendorSel.join(","));
      const res = await fetch(`/api/reports/vendor-spend?${qp.toString()}`);
      const json = (await res.json()) as ApiResp;
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  // quick ranges
  function applyRange(kind: "wtd" | "lw" | "mtd" | "ytd" | "clear") {
    const today = new Date();
    let a: Date, b: Date;
    if (kind === "clear") { setFrom(""); setTo(""); setTimeout(run, 0); return; }
    if (kind === "wtd") { a = startOfWeekMonday(today); b = today; }
    else if (kind === "lw") { const m = startOfWeekMonday(today); a = new Date(m); a.setDate(a.getDate() - 7); b = new Date(a); b.setDate(a.getDate() + 6); }
    else if (kind === "mtd") { a = startOfMonth(today); b = today; }
    else { a = startOfYear(today); b = today; }
    setFrom(toDMY(a));
    setTo(toDMY(b));
    setTimeout(run, 0);
  }

  const VENDORS = useMemo(() => data?.vendors ?? vendorOptions, [data, vendorOptions]);

  async function refreshVendorsFromShopify() {
    setSyncingVendors(true);
    try {
      await fetch("/api/stocked-brands", { method: "POST" }); // sync with Shopify
      await loadVendors(); // reload the list
    } finally {
      setSyncingVendors(false);
    }
  }

  // grid template for dynamic vendor columns
  const gridCols = useMemo(() => {
    const vendorCols = (data?.vendors ?? []).map(() => "140px").join(" ");
    return `minmax(200px,1.2fr) 160px ${vendorCols} 120px 120px 120px`;
  }, [data?.vendors]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>GAP Analysis</h1>
        <p className="small">See spend by vendor per customer. Filter by sales rep, vendor, and date range.</p>
      </section>

      <section className="card grid" style={{ gap: 10 }}>
        <div className="grid grid-2" style={{ gap: 10 }}>
          <div className="field">
            <label>From</label>
            <input placeholder="dd/mm/yyyy" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input placeholder="dd/mm/yyyy" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="row small" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="muted">Quick ranges:</span>
          <button type="button" className="chip" onClick={() => applyRange("wtd")}>Week to date</button>
          <button type="button" className="chip" onClick={() => applyRange("lw")}>Last week</button>
          <button type="button" className="chip" onClick={() => applyRange("mtd")}>Month to date</button>
          <button type="button" className="chip" onClick={() => applyRange("ytd")}>Year to date</button>
          <button type="button" className="chip" onClick={() => applyRange("clear")}>Clear</button>
        </div>

        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          <button className="primary" onClick={run} disabled={loading}>
            {loading ? "Running…" : "Run"}
          </button>
          <button
            type="button"
            className="chip"
            onClick={refreshVendorsFromShopify}
            disabled={syncingVendors}
            title="Pull vendor list from Shopify products and update the filter list"
          >
            {syncingVendors ? "Refreshing vendors…" : "Refresh vendors (Shopify)"}
          </button>
        </div>

        <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
          <div>
            <div className="small" style={{ marginBottom: 6 }}>Sales Reps</div>
            <div className="row small" style={{ gap: 12, flexWrap: "wrap" }}>
              {reps.map((r) => {
                const checked = repSel.includes(r.name);
                return (
                  <label key={r.id} className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setRepSel((prev) =>
                          e.target.checked ? [...prev, r.name] : prev.filter((x) => x !== r.name)
                        )
                      }
                    />
                    {r.name}
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <div className="small" style={{ marginBottom: 6 }}>Vendors</div>
            <div className="row small" style={{ gap: 12, flexWrap: "wrap" }}>
              {vendorOptions.map((v) => {
                const checked = vendorSel.includes(v);
                return (
                  <label key={v} className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setVendorSel((prev) => (e.target.checked ? [...prev, v] : prev.filter((x) => x !== v)))
                      }
                    />
                    {v}
                  </label>
                );
              })}
              {vendorOptions.length === 0 && <span className="muted">No vendors yet.</span>}
            </div>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="card">
        {!data ? (
          <p className="small muted">Run the report to see results.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            {/* header */}
            <div
              className="small"
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                columnGap: 12,
                fontWeight: 600,
                paddingBottom: 8,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div>Customer</div>
              <div>Sales Rep</div>
              {(data.vendors ?? []).map((v) => <div key={v}>{v}</div>)}
              <div>Subtotal</div>
              <div>Taxes</div>
              <div>Total</div>
            </div>

            {/* rows */}
            {data.rows.map((r) => {
              const per = (r.vendors || r.perVendor || {}) as Record<string, number>;
              return (
                <div
                  key={r.customerId}
                  className="small"
                  style={{
                    display: "grid",
                    gridTemplateColumns: gridCols,
                    columnGap: 12,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div>{r.salonName}</div>
                  <div>{r.salesRep || "—"}</div>
                  {(data.vendors ?? []).map((v) => <div key={v}>{fmtMoney(per[v])}</div>)}
                  <div>{fmtMoney(r.subtotal)}</div>
                  <div>{fmtMoney(r.taxes)}</div>
                  <div style={{ fontWeight: 600 }}>{fmtMoney(r.total)}</div>
                </div>
              );
            })}

            {data.rows.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>No results.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
