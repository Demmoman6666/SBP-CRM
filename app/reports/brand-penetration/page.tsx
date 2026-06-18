"use client";

import { useEffect, useState } from "react";

type Rep = { id: string; name: string };
type Row = { customerId: string; salonName: string; salesRep: string | null; stage: string; brands: Record<string, boolean>; count: number; allFour: boolean };
type Summary = { brand: string; customers: number; pct: number };
type Buckets = { all: number; three: number; two: number; one: number; none: number };

export default function BrandPenetrationPage() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [buckets, setBuckets] = useState<Buckets | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [repId, setRepId] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [filterCount, setFilterCount] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/sales-reps", { cache: "no-store" }).then(r => r.json()).then(j => setReps(Array.isArray(j) ? j : [])).catch(() => setReps([]));
  }, []);

  async function run() {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (repId) qs.set("repId", repId);
      const r = await fetch(`/api/reports/brand-penetration?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setBrands(j.brands || []); setRows(j.rows || []); setSummary(j.summary || []); setBuckets(j.buckets || null); setTotal(j.total || 0);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  const filtered = rows.filter(r => {
    if (search && !r.salonName.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterBrand && !r.brands[filterBrand]) return false;
    if (filterCount === "all" && !r.allFour) return false;
    if (filterCount === "0" && r.count !== 0) return false;
    if (filterCount === "1" && r.count !== 1) return false;
    if (filterCount === "2" && r.count !== 2) return false;
    if (filterCount === "3" && r.count !== 3) return false;
    return true;
  });

  function setRange(type: "30" | "month" | "year") {
    const now = new Date(); const e = now.toISOString().slice(0, 10); let s: string;
    if (type === "month") s = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    else if (type === "year") s = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    else { const d = new Date(now); d.setDate(d.getDate() - 30); s = d.toISOString().slice(0, 10); }
    setFrom(s); setTo(e);
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Brand Penetration</h1>
        <p className="small muted">See which of your customers stock each of your brands — and who is missing opportunities.</p>
      </section>

      <section className="card">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 10 }}>
          <div className="field"><label>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="field"><label>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div className="field">
            <label>Sales Rep</label>
            <select value={repId} onChange={e => setRepId(e.target.value)}>
              <option value="">All reps</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <span className="small muted">Quick:</span>
          <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => setRange("30")}>Last 30 days</button>
          <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => setRange("month")}>Month to date</button>
          <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => setRange("year")}>Year to date</button>
          <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => { setFrom(""); setTo(""); }}>All time</button>
        </div>
        <button className="primary" onClick={run} disabled={loading}>{loading ? "Running..." : "Run Report"}</button>
        {error && <div className="small" style={{ color: "var(--red)", marginTop: 8 }}>{error}</div>}
      </section>

      {summary.length > 0 && (
        <>
          <section className="card">
            <h2 style={{ marginBottom: 12 }}>Brand Penetration</h2>
            <div style={{ display: "grid", gap: 12 }}>
              {summary.map(s => (
                <div key={s.brand}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{s.brand}</span>
                    <span className="small muted">{s.customers} of {total} ({s.pct}%)</span>
                  </div>
                  <div style={{ height: 10, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${s.pct}%`, background: "var(--pink)", borderRadius: 999, transition: "width 0.5s ease" }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {buckets && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
              {[
                { label: `All ${brands.length} brands`, value: buckets.all, color: "#dcfce7", tc: "#16a34a" },
                { label: "3 brands", value: buckets.three, color: "#fef9c3", tc: "#ca8a04" },
                { label: "2 brands", value: buckets.two, color: "#fce7f3", tc: "#db2777" },
                { label: "1 brand", value: buckets.one, color: "#fee2e2", tc: "#dc2626" },
                { label: "No brands", value: buckets.none, color: "#f3f4f6", tc: "#6b7280" },
              ].map(b => (
                <div key={b.label} className="card" style={{ textAlign: "center", background: b.color, border: "none" }}>
                  <div style={{ fontSize: "2rem", fontWeight: 800, color: b.tc }}>{b.value}</div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, color: b.tc }}>{b.label}</div>
                  <div style={{ fontSize: "0.7rem", color: b.tc, opacity: 0.8 }}>{total > 0 ? `${Math.round((b.value / total) * 100)}%` : "0%"}</div>
                </div>
              ))}
            </div>
          )}

          <section className="card">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, alignItems: "flex-end" }}>
              <div className="field" style={{ flex: "1 1 160px" }}><label>Search</label><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Salon name..." /></div>
              <div className="field" style={{ flex: "1 1 140px" }}>
                <label>Filter by brand</label>
                <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
                  <option value="">All brands</option>
                  {brands.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: "1 1 140px" }}>
                <label>Filter by count</label>
                <select value={filterCount} onChange={e => setFilterCount(e.target.value)}>
                  <option value="">Any</option>
                  <option value="all">All {brands.length}</option>
                  <option value="3">Exactly 3</option>
                  <option value="2">Exactly 2</option>
                  <option value="1">Exactly 1</option>
                  <option value="0">None</option>
                </select>
              </div>
              {(search || filterBrand || filterCount) && <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => { setSearch(""); setFilterBrand(""); setFilterCount(""); }}>Clear</button>}
            </div>
            <p className="small muted" style={{ marginBottom: 10 }}>{filtered.length} customers</p>
            <div className="table-wrap">
              <table className="table" style={{ minWidth: Math.max(500, brands.length * 120 + 280) }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 180 }}>Customer</th>
                    <th style={{ minWidth: 100 }}>Rep</th>
                    {brands.map(b => <th key={b} style={{ textAlign: "center", minWidth: 110, background: "#FEF0F9", borderLeft: "2px solid var(--pink)" }}>{b}</th>)}
                    <th style={{ textAlign: "center", minWidth: 80 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => (
                    <tr key={row.customerId}>
                      <td style={{ fontWeight: 500 }}><a href={`/customers/${row.customerId}`} style={{ color: "inherit", textDecoration: "none" }}>{row.salonName}</a></td>
                      <td className="small muted">{row.salesRep || "—"}</td>
                      {brands.map(b => (
                        <td key={b} style={{ textAlign: "center", borderLeft: "2px solid var(--pink)", background: row.brands[b] ? (i % 2 === 0 ? "#FFF5FC" : "#FEF0F9") : (i % 2 === 0 ? "#FAFAFA" : "#F5F5F5") }}>
                          {row.brands[b]
                            ? <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "#dcfce7", color: "#16a34a", fontWeight: 700, fontSize: "0.8rem" }}>✓</span>
                            : <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "#fee2e2", color: "#dc2626", fontWeight: 700, fontSize: "0.8rem" }}>✕</span>}
                        </td>
                      ))}
                      <td style={{ textAlign: "center", fontWeight: 700 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "50%", fontWeight: 700, fontSize: "0.85rem", background: row.count === brands.length ? "#dcfce7" : row.count === 0 ? "#fee2e2" : "#fef9c3", color: row.count === brands.length ? "#16a34a" : row.count === 0 ? "#dc2626" : "#ca8a04" }}>
                          {row.count}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={brands.length + 3}><p className="small muted" style={{ textAlign: "center", padding: "20px 0" }}>No customers match.</p></td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {!loading && rows.length === 0 && brands.length === 0 && (
        <section className="card">
          <p className="small muted">No brands are marked visible in reports. Go to <a href="/settings/global/stocked-brands">Brand Management</a> and tick the Reports column.</p>
        </section>
      )}
    </div>
  );
}
