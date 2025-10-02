"use client";

import { useEffect, useMemo, useState } from "react";

type Rep = { id: string; name: string };
type ApiRow = {
  customerId: string;
  customer: string;
  repName: string | null;
  orders: number;
  gross: number;
  discount: number;
  net: number;
  marginPct: number | null;
  currency: string;
};
type ApiResp = {
  ok: boolean;
  from: string | null;
  to: string | null;
  count: number;
  rows: ApiRow[];
};

function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
function money(n: number, c = "GBP") {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(n || 0);
  } catch {
    return `${c} ${(n || 0).toFixed(2)}`;
  }
}
const isCuid = (s: string) => /^c[a-z0-9]{24,}$/i.test(s);

// Normalise any shape returned by /api/sales-reps
function normaliseReps(payload: any): Rep[] {
  if (payload?.ok && Array.isArray(payload.reps)) {
    return payload.reps.map((n: any) => ({ id: String(n || ""), name: String(n || "") }));
  }
  if (Array.isArray(payload) && payload.length && (payload[0]?.id || payload[0]?.name)) {
    return payload
      .map((r: any) => ({ id: String(r.id ?? r.name ?? ""), name: String(r.name ?? r.id ?? "") }))
      .filter((r) => r.id && r.name);
  }
  if (Array.isArray(payload) && typeof payload[0] === "string") {
    return payload.map((n: any) => ({ id: String(n || ""), name: String(n || "") }));
  }
  return [];
}

export default function SalesByCustomerReport() {
  const today = useMemo(() => new Date(), []);
  const startOfMonth = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today]);

  const [from, setFrom] = useState<string>(ymd(startOfMonth));
  const [to, setTo] = useState<string>(ymd(today));

  const [reps, setReps] = useState<Rep[]>([]);
  const [repId, setRepId] = useState<string>("");
  const [repName, setRepName] = useState<string>("");

  const [rows, setRows] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load reps (prefer IDs from table, fallback to merged names)
  useEffect(() => {
    (async () => {
      try {
        const r1 = await fetch("/api/sales-reps?tableOnly=1", { cache: "no-store", credentials: "include" });
        const j1 = r1.ok ? await r1.json().catch(() => null) : null;
        const list1 = normaliseReps(j1).filter((r) => isCuid(r.id));
        if (list1.length) {
          setReps(list1);
          setRepId(list1[0].id);
          setRepName(list1[0].name);
          return;
        }
        const r2 = await fetch("/api/sales-reps?full=1", { cache: "no-store", credentials: "include" });
        const j2 = await r2.json().catch(() => null);
        const list2 = normaliseReps(j2);
        setReps(list2);
        if (list2.length) {
          setRepId(list2[0].id);
          setRepName(list2[0].name);
        }
      } catch {/* ignore */}
    })();
  }, []);

  useEffect(() => {
    const f = reps.find((r) => r.id === repId);
    setRepName(f?.name || "");
  }, [repId, reps]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (repId) {
      // Send both canonical id and name (API supports either)
      p.set("repId", repId);
      p.set("staff", repName || repId);
    }
    p.set("limit", "2000");
    return p.toString();
  }, [from, to, repId, repName]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/reports/sales-by-customer?${qs}`, { cache: "no-store", credentials: "include" });
      const j = (await r.json()) as ApiResp;
      if (!r.ok || !j.ok) throw new Error((j as any)?.error || "Failed to load");
      setRows(j.rows || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [qs]);

  const totalOrders = rows.reduce((a, r) => a + r.orders, 0);
  const totalGross = rows.reduce((a, r) => a + r.gross, 0);
  const totalDiscount = rows.reduce((a, r) => a + r.discount, 0);
  const totalNet = rows.reduce((a, r) => a + r.net, 0);
  const currency = rows[0]?.currency || "GBP";

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Sales by Customer</h1>
            <p className="small">Ex-VAT, after discounts. Includes paid and unpaid orders.</p>
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <button className="btn" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="card">
        <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
          <div>
            <label>Date from</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label>Date to</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label>Sales Rep</label>
            <select value={repId} onChange={(e) => setRepId(e.target.value)}>
              <option value="">— Any —</option>
              {reps.map((r) => (
                <option key={`${r.id}-${r.name}`} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div style={{ alignSelf: "end" }}>
            <button className="btn" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Apply"}
            </button>
          </div>
        </div>
      </section>

      {err && (
        <div className="card" style={{ borderColor: "#fca5a5" }}>
          <div className="small" style={{ color: "#b91c1c" }}>{err}</div>
        </div>
      )}

      {/* Totals */}
      <section className="grid grid-4" style={{ gap: 12 }}>
        <div className="card">
          <div className="small muted">Orders</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{totalOrders}</div>
        </div>
        <div className="card">
          <div className="small muted">Gross (ex-VAT)</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{money(totalGross, currency)}</div>
        </div>
        <div className="card">
          <div className="small muted">Discount (ex-VAT)</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{money(totalDiscount, currency)}</div>
        </div>
        <div className="card">
          <div className="small muted">Net (ex-VAT)</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{money(totalNet, currency)}</div>
        </div>
      </section>

      {/* Table */}
      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Customer</th>
              <th style={{ width: 180 }}>Sales Rep</th>
              <th style={{ width: 110, textAlign: "right" }}>Orders</th>
              <th style={{ width: 160, textAlign: "right" }}>Gross (ex-VAT)</th>
              <th style={{ width: 160, textAlign: "right" }}>Discount (ex-VAT)</th>
              <th style={{ width: 160, textAlign: "right" }}>Net (ex-VAT)</th>
              <th style={{ width: 110, textAlign: "right" }}>Margin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customerId}>
                <td className="small">{r.customer}</td>
                <td className="small">{r.repName || "—"}</td>
                <td className="small" style={{ textAlign: "right" }}>{r.orders}</td>
                <td className="small" style={{ textAlign: "right" }}>{money(r.gross, r.currency)}</td>
                <td className="small" style={{ textAlign: "right" }}>{money(r.discount, r.currency)}</td>
                <td className="small" style={{ textAlign: "right" }}>{money(r.net, r.currency)}</td>
                <td className="small" style={{ textAlign: "right" }}>
                  {r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7}><div className="small muted">No results.</div></td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="small muted">
        Margin% requires item cost data. If you want this populated, we can wire in a cost source (e.g. per-SKU costs) and compute COGS.
      </section>
    </div>
  );
}
