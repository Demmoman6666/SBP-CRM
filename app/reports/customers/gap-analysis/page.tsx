// app/reports/customers/gap-analysis/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Rep = { id: string; name: string };

type ApiRow = {
  customerId: string;
  salonName: string;
  salesRep: string | null;
  vendors: Record<string, number>;
  subtotal: number;
  taxes: number;
  total: number;
};

type ApiResp = {
  vendors: string[];
  rows: ApiRow[];
};

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

function fmt(n?: number) {
  const v = typeof n === "number" ? n : 0;
  return v ? GBP.format(v) : "—";
}

export default function GapAnalysisPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reps, setReps] = useState<Rep[]>([]);
  const [repSel, setRepSel] = useState<string[]>([]);
  const [vendorSel, setVendorSel] = useState<string[]>(["Goddess", "MY.ORGANICS", "Neal & Wolf", "Procare", "REF Stockholm"]);

  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);

  // load reps
  useEffect(() => {
    fetch("/api/sales-reps")
      .then(r => r.json())
      .then((arr: Rep[]) => {
        setReps(arr || []);
        setRepSel(arr.map(r => r.name)); // default select all reps
      })
      .catch(() => setReps([]));
  }, []);

  async function run() {
    setLoading(true);
    try {
      const qp = new URLSearchParams();
      if (from) qp.set("from", from);
      if (to) qp.set("to", to);
      if (repSel.length) qp.set("reps", repSel.join(","));
      if (vendorSel.length) qp.set("vendors", vendorSel.join(","));
      const res = await fetch(`/api/reports/vendor-spend?${qp.toString()}`);
      const json = (await res.json()) as ApiResp;
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  const VENDORS = useMemo(
    () => data?.vendors ?? vendorSel,
    [data, vendorSel]
  );

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>GAP Analysis</h1>
        <p className="small">See spend by vendor per customer. Filter by sales rep, vendor, and date range.</p>
      </section>

      {/* Filters */}
      <section className="card grid" style={{ gap: 10 }}>
        <div className="field">
          <label>From</label>
          <input placeholder="dd/mm/yyyy" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input placeholder="dd/mm/yyyy" value={to} onChange={e => setTo(e.target.value)} />
        </div>

        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          <button className="primary" onClick={run} disabled={loading}>
            {loading ? "Running…" : "Run"}
          </button>
        </div>

        <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
          <div>
            <div className="small" style={{ marginBottom: 6 }}>Sales Reps</div>
            <div className="row small" style={{ gap: 12, flexWrap: "wrap" }}>
              {reps.map(r => {
                const checked = repSel.includes(r.name);
                return (
                  <label key={r.id} className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e =>
                        setRepSel(prev =>
                          e.target.checked ? [...prev, r.name] : prev.filter(x => x !== r.name)
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
              {["Goddess", "MY.ORGANICS", "Neal & Wolf", "Procare", "REF Stockholm"].map(v => {
                const checked = vendorSel.includes(v);
                return (
                  <label key={v} className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e =>
                        setVendorSel(prev =>
                          e.target.checked ? [...prev, v] : prev.filter(x => x !== v)
                        )
                      }
                    />
                    {v}
                  </label>
                );
              })}
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
            <div
              className="small"
              style={{
                display: "grid",
                gridTemplateColumns: `minmax(200px, 1.2fr) 160px ${VENDORS.map(() => "140px").join(" ")} 120px 120px 120px`,
                columnGap: 12,
                fontWeight: 600,
                paddingBottom: 8,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div>Customer</div>
              <div>Sales Rep</div>
              {VENDORS.map(v => <div key={v}>{v}</div>)}
              <div>Subtotal</div>
              <div>Taxes</div>
              <div>Total</div>
            </div>

            {data.rows.map(r => (
              <div
                key={r.customerId}
                className="small"
                style={{
                  display: "grid",
                  gridTemplateColumns: `minmax(200px, 1.2fr) 160px ${VENDORS.map(() => "140px").join(" ")} 120px 120px 120px`,
                  columnGap: 12,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div>{r.salonName}</div>
                <div>{r.salesRep || "—"}</div>
                {VENDORS.map(v => <div key={v}>{fmt(r.vendors[v])}</div>)}
                <div>{fmt(r.subtotal)}</div>
                <div>{fmt(r.taxes)}</div>
                <div style={{ fontWeight: 600 }}>{fmt(r.total)}</div>
              </div>
            ))}

            {data.rows.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>No results.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
