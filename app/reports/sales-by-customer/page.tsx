// app/reports/sales-by-customer/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Rep = { id: string; name: string };
type Row = {
  customerId: string | null;
  salonName: string | null;
  customerName: string | null;
  orders: number;
  gross: number;
  discount: number;
  net: number;
  cost: number;
  margin: number;
  marginPct: number | null;
  currency: string;
};

function monthBounds(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)).toISOString().slice(0, 10);
  return { start, end };
}
function money(n: number, c = "GBP") {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(n || 0);
  } catch {
    return `${c} ${(n || 0).toFixed(2)}`;
  }
}
const isCuid = (s: string) => /^c[a-z0-9]{24,}$/i.test(s);

// Reuse flexible normaliser (works with both /api/sales-reps responses)
function normaliseReps(payload: any): Rep[] {
  if (Array.isArray(payload) && payload.length && (payload[0]?.id || payload[0]?.name)) {
    return payload
      .map((r: any) => ({ id: String(r.id ?? r.name ?? ""), name: String(r.name ?? r.id ?? "") }))
      .filter((r) => r.id && r.name);
  }
  if (payload?.ok && Array.isArray(payload.reps)) {
    return payload.reps.map((n: any) => ({ id: String(n || ""), name: String(n || "") }));
  }
  if (Array.isArray(payload) && typeof payload[0] === "string") {
    return payload.map((n: any) => ({ id: String(n || ""), name: String(n || "") }));
  }
  return [];
}

export default function SalesByCustomerPage() {
  const { start: defStart, end: defEnd } = monthBounds();
  const [from, setFrom] = useState<string>(defStart);
  const [to, setTo] = useState<string>(defEnd);

  const [reps, setReps] = useState<Rep[]>([]);
  const [repId, setRepId] = useState<string>("");
  const [repName, setRepName] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [currency, setCurrency] = useState<string>("GBP");
  const [totals, setTotals] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Load reps (prefer table IDs, fall back to names)
  useEffect(() => {
    (async () => {
      try {
        const r1 = await fetch("/api/sales-reps?tableOnly=1", { cache: "no-store" });
        const j1 = r1.ok ? await r1.json().catch(() => null) : null;
        const list1 = normaliseReps(j1).filter((r) => isCuid(r.id));
        if (list1.length) {
          setReps(list1);
          setRepId(list1[0].id);
          setRepName(list1[0].name);
          return;
        }
      } catch {}
      try {
        const r2 = await fetch("/api/sales-reps?full=1", { cache: "no-store" });
        const j2 = await r2.json().catch(() => null);
        const list2 = normaliseReps(j2);
        setReps(list2);
        if (list2.length) {
          setRepId(list2[0].id);
          setRepName(list2[0].name);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const found = reps.find((r) => r.id === repId);
    setRepName(found?.name || "");
  }, [repId, reps]);

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const qs = new URLSearchParams({
        from,
        to,
        repId,
        repName: repName || repId,
        staff: repName || repId,
      });
      const res = await fetch(`/api/reports/sales-by-customer?${qs.toString()}`, {
        cache: "no-store",
        credentials: "include",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to load");
      setRows(j.rows || []);
      setCurrency(j.currency || "GBP");
      setTotals(j.totals || null);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load");
      setRows([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }

  const grand = useMemo(() => {
    if (!totals) return null;
    return {
      orders: totals.orders || 0,
      gross: totals.gross || 0,
      discount: totals.discount || 0,
      net: totals.net || 0,
      cost: totals.cost || 0,
      margin: (totals.net || 0) - (totals.cost || 0),
      marginPct:
        totals.net > 0 ? (((totals.net || 0) - (totals.cost || 0)) / (totals.net || 1)) * 100 : null,
    };
  }, [totals]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Sales by Customer</h1>
        <p className="small muted">
          Sums all Shopify orders (paid & unpaid) in the period. Revenue shown is <b>ex VAT</b>. Net =
          Gross − Discounts.
        </p>
      </section>

      <section className="card grid" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <div className="field">
            <label>Sales Rep</label>
            <select value={repId} onChange={(e) => setRepId(e.target.value)}>
              {reps.map((r) => (
                <option key={`${r.id}-${r.name}`} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <button className="primary" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Load Report"}
            </button>
          </div>
        </div>
        {msg && <div className="small" style={{ color: "#b91c1c" }}>{msg}</div>}
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <div className="small muted">Showing: {from} → {to}</div>
          <div className="small muted">Currency: {currency}</div>
        </div>
        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Customer</th>
                <th>Orders</th>
                <th>Gross (ex VAT)</th>
                <th>Discounts</th>
                <th>Net (ex VAT)</th>
                <th>Cost</th>
                <th>Margin</th>
                <th>Margin %</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="small muted" style={{ textAlign: "center" }}>
                    No results.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.customerId || `${r.salonName}-${r.customerName}`}>
                  <td style={{ textAlign: "left" }}>
                    {r.salonName || r.customerName || "Unlinked customer"}
                  </td>
                  <td style={{ textAlign: "right" }}>{r.orders}</td>
                  <td style={{ textAlign: "right" }}>{money(r.gross, currency)}</td>
                  <td style={{ textAlign: "right" }}>{money(r.discount, currency)}</td>
                  <td style={{ textAlign: "right" }}>{money(r.net, currency)}</td>
                  <td style={{ textAlign: "right" }}>{money(r.cost, currency)}</td>
                  <td style={{ textAlign: "right" }}>{money(r.margin, currency)}</td>
                  <td style={{ textAlign: "right" }}>
                    {r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
            {grand && (
              <tfoot>
                <tr>
                  <th style={{ textAlign: "left" }}>TOTAL</th>
                  <th style={{ textAlign: "right" }}>{grand.orders}</th>
                  <th style={{ textAlign: "right" }}>{money(grand.gross, currency)}</th>
                  <th style={{ textAlign: "right" }}>{money(grand.discount, currency)}</th>
                  <th style={{ textAlign: "right" }}>{money(grand.net, currency)}</th>
                  <th style={{ textAlign: "right" }}>{money(grand.cost, currency)}</th>
                  <th style={{ textAlign: "right" }}>{money(grand.margin, currency)}</th>
                  <th style={{ textAlign: "right" }}>
                    {grand.marginPct == null ? "—" : `${grand.marginPct.toFixed(1)}%`}
                  </th>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
