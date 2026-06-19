"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Row = {
  sku: string;
  productName: string;
  unitsInWindow: number;
  avgMonthly: number;
  suggestedMonthlyPAR: number;
};

type ApiRes = {
  params: {
    customerId: string;
    brand: string;
    timeframe: "mtd" | "lm" | "l2m" | "l3m";
    monthsEq: number;
    start: string;
    end: string;
    safetyPct: number;
    coverageMonths: number;
    packSize: number;
  };
  rows: Row[];
};

type ParRecord = { sku: string; parQty: number; updatedAt: string };

type SortKey =
  | "sku"
  | "productName"
  | "unitsInWindow"
  | "avgMonthly"
  | "suggestedMonthlyPAR"
  | "agreedPar"
  | "delta";
type SortDir = "asc" | "desc";

const TF_LABELS = {
  mtd: "Month to date",
  lm: "Last month",
  l2m: "Last 2 months",
  l3m: "Last 3 months",
} as const;

const nf0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n: number) => nf0.format(Math.round(Number(n) || 0));
const fmt2 = (n: number) => nf2.format(Number(n) || 0);

function useDebounced<T>(value: T, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function StockOrderParPage() {
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const debCustomerQuery = useDebounced(customerQuery, 250);
  const [customerResults, setCustomerResults] = useState<Array<{ id: string; name: string; extra?: string }>>([]);
  const [customerOpen, setCustomerOpen] = useState(false);

  const [brand, setBrand] = useState<string>("");
  const [brandQuery, setBrandQuery] = useState("");
  const debBrandQuery = useDebounced(brandQuery, 250);
  const [brandResults, setBrandResults] = useState<string[]>([]);
  const [brandOpen, setBrandOpen] = useState(false);

  const [timeframe, setTimeframe] = useState<ApiRes["params"]["timeframe"]>("mtd");
  const [safetyPct, setSafetyPct] = useState("0.15");
  const [coverageMonths, setCoverageMonths] = useState("1");
  const [packSize, setPackSize] = useState("1");

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pars, setPars] = useState<Record<string, ParRecord>>({});
  const [editPar, setEditPar] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<SortKey>("productName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const canRun = useMemo(() => !!(customer?.id && brand.trim()), [customer, brand]);

  useEffect(() => {
    let ok = true;
    const q = debCustomerQuery.trim();
    if (q.length < 2) { setCustomerResults([]); return; }
    fetch("/api/search/customers?q=" + encodeURIComponent(q) + "&limit=12")
      .then(r => (r.ok ? r.json() : { results: [] }))
      .then(j => ok && setCustomerResults(j.results || []))
      .catch(() => ok && setCustomerResults([]));
    return () => { ok = false; };
  }, [debCustomerQuery]);

  useEffect(() => {
    let ok = true;
    const q = debBrandQuery.trim();
    fetch("/api/search/vendors?q=" + encodeURIComponent(q) + "&limit=20")
      .then(r => (r.ok ? r.json() : { results: [] }))
      .then(j => ok && setBrandResults(j.results || []))
      .catch(() => ok && setBrandResults([]));
    return () => { ok = false; };
  }, [debBrandQuery]);

  function runReport() {
    if (!customer?.id || !brand) return;
    setLoading(true);
    setError(null);
    setData(null);
    setEditPar({});

    const qs = new URLSearchParams({ customerId: customer.id, brand, timeframe, safetyPct, coverageMonths, packSize }).toString();

    fetch("/api/reports/demand-par?" + qs)
      .then(r => r.json().then(j => ({ ok: r.ok, j, status: r.status })))
      .then(({ ok, j, status }) => {
        if (!ok) throw new Error(j?.error || "Report failed (" + status + ")");
        const json = j as ApiRes;
        json.rows = (json.rows || []).map(r => ({ ...r, sku: r.sku ?? "" }));
        setData(json);

        return fetch("/api/par/list?customerId=" + encodeURIComponent(customer.id)).then(r2 => {
          if (r2.ok) {
            return r2.json().then((j2: { records: ParRecord[] }) => {
              const bySku: Record<string, ParRecord> = {};
              (j2.records || []).forEach(rec => { if (rec.sku) bySku[rec.sku] = rec; });
              setPars(bySku);
              const seed: Record<string, string> = {};
              (json.rows || []).forEach(row => {
                const agreed = bySku[row.sku]?.parQty ?? null;
                seed[row.sku] = String(agreed ?? row.suggestedMonthlyPAR);
              });
              setEditPar(seed);
            });
          } else {
            setPars({});
          }
        });
      })
      .catch((e: any) => setError(e?.message || "Failed to load report"))
      .finally(() => setLoading(false));
  }

  function setEdit(sku: string, val: string) {
    setEditPar(s => ({ ...s, [sku]: val }));
  }

  function saveOne(sku: string) {
    if (!customer?.id) return;
    const val = editPar[sku];
    const n = Number(val);
    if (!sku) { alert("Missing SKU"); return; }
    if (!Number.isFinite(n) || n < 0) { alert("Enter a valid non-negative number"); return; }
    fetch("/api/par/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: customer.id, sku, parQty: Math.round(n) }),
    })
      .then(res => res.json().then(j => ({ ok: res.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) { alert(j?.error || "Save failed"); return; }
        setPars(p => ({ ...p, [sku]: { sku, parQty: Math.round(n), updatedAt: new Date().toISOString() } }));
      });
  }

  async function saveAllVisible() {
    if (!data?.rows?.length || !customer?.id) return;
    const toSave = data.rows
      .filter(r => r.sku)
      .map(r => ({ sku: r.sku, parQty: Math.max(0, Math.round(Number(editPar[r.sku] ?? r.suggestedMonthlyPAR))) }));

    for (const item of toSave) {
      const res = await fetch("/api/par/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: customer.id, sku: item.sku, parQty: item.parQty }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.error || "Failed on " + item.sku);
        return;
      }
    }
    const r2 = await fetch("/api/par/list?customerId=" + encodeURIComponent(customer.id));
    if (r2.ok) {
      const j = (await r2.json()) as { records: ParRecord[] };
      const bySku: Record<string, ParRecord> = {};
      (j.records || []).forEach(rec => { if (rec.sku) bySku[rec.sku] = rec; });
      setPars(bySku);
    }
  }

  const rows = useMemo(() => {
    const base = data?.rows || [];
    const withAgreed = base.map(r => {
      const agreed = pars[r.sku]?.parQty ?? null;
      const delta = (r.suggestedMonthlyPAR ?? 0) - (agreed ?? 0);
      return { ...r, agreedPar: agreed, delta };
    });

    const sorted = [...withAgreed].sort((a: any, b: any) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return sorted;
  }, [data, pars, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  function downloadCsv() {
    if (!rows.length || !customer) return;
    const headers = ["Customer", "Brand", "SKU", "Product Name", "Units (window)", "Avg Monthly", "Recommended Monthly Stock", "Agreed Stock Level", "Delta"];
    const csv = [headers.join(",")]
      .concat(rows.map((r: any) => [
        '"' + (customer?.name || "").replace(/"/g, '\\"') + '"',
        '"' + (brand || "").replace(/"/g, '\\"') + '"',
        r.sku,
        '"' + (r.productName || "").replace(/"/g, '\\"') + '"',
        r.unitsInWindow,
        (Number(r.avgMonthly ?? 0)).toFixed(2),
        r.suggestedMonthlyPAR,
        r.agreedPar ?? "",
        r.delta ?? "",
      ].join(",")))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "customer-stock-forecast_" + customer?.name + "_" + brand + "_" + timeframe + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setCustomerOpen(false);
        setBrandOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return (
    <div ref={rootRef} className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1 style={{ marginBottom: 2 }}>Stock &amp; Order Forecast</h1>
        <p className="small muted">Predicted demand and recommended stock levels per customer and brand.</p>
      </section>

      {/* Search controls */}
      <section className="card" style={{ overflow: "visible" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div className="field" style={{ position: "relative", margin: 0 }}>
            <label>Customer</label>
            <input
              placeholder="Type to search customers..."
              value={customer ? customer.name : customerQuery}
              onChange={e => { setCustomer(null); setCustomerQuery(e.target.value); setCustomerOpen(true); }}
              onFocus={() => setCustomerOpen(true)}
            />
            {customer && (
              <button
                type="button"
                onClick={() => { setCustomer(null); setCustomerQuery(""); setCustomerResults([]); setCustomerOpen(true); }}
                style={{ position: "absolute", right: 8, top: 30, fontSize: "0.7rem", background: "none", border: "none", color: "var(--muted)", textDecoration: "underline", cursor: "pointer", minHeight: "auto", padding: 0 }}
              >
                Clear
              </button>
            )}
            {customerOpen && !customer && (
              <ul style={{ position: "absolute", zIndex: 30, marginTop: 4, width: "100%", maxHeight: 256, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", boxShadow: "var(--shadow-lg)", listStyle: "none", padding: 0 }}>
                {debCustomerQuery.length < 2 && <li style={{ padding: "8px 12px", fontSize: "0.85rem", color: "var(--muted)" }}>Type at least 2 characters...</li>}
                {debCustomerQuery.length >= 2 && customerResults.length === 0 && <li style={{ padding: "8px 12px", fontSize: "0.85rem", color: "var(--muted)" }}>Searching...</li>}
                {customerResults.map(c => (
                  <li
                    key={c.id}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setCustomer({ id: c.id, name: c.name }); setCustomerQuery(""); setCustomerOpen(false); }}
                    style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{c.name}</div>
                    {c.extra && <div className="small muted">{c.extra}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="field" style={{ position: "relative", margin: 0 }}>
            <label>Brand</label>
            <input
              placeholder="Type to search vendors..."
              value={brand ? brand : brandQuery}
              onChange={e => { setBrand(""); setBrandQuery(e.target.value); setBrandOpen(true); }}
              onFocus={() => setBrandOpen(true)}
            />
            {brand && (
              <button
                type="button"
                onClick={() => { setBrand(""); setBrandQuery(""); setBrandResults([]); setBrandOpen(true); }}
                style={{ position: "absolute", right: 8, top: 30, fontSize: "0.7rem", background: "none", border: "none", color: "var(--muted)", textDecoration: "underline", cursor: "pointer", minHeight: "auto", padding: 0 }}
              >
                Clear
              </button>
            )}
            {brandOpen && !brand && (
              <ul style={{ position: "absolute", zIndex: 30, marginTop: 4, width: "100%", maxHeight: 256, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", boxShadow: "var(--shadow-lg)", listStyle: "none", padding: 0 }}>
                {brandResults.length === 0 && <li style={{ padding: "8px 12px", fontSize: "0.85rem", color: "var(--muted)" }}>Searching...</li>}
                {brandResults.map(b => (
                  <li
                    key={b}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setBrand(b); setBrandQuery(""); setBrandOpen(false); }}
                    style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label>Timeframe</label>
            <select value={timeframe} onChange={e => setTimeframe(e.target.value as typeof timeframe)}>
              <option value="mtd">Month to date</option>
              <option value="lm">Last month</option>
              <option value="l2m">Last 2 months</option>
              <option value="l3m">Last 3 months</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className="small"
          style={{ background: "none", border: "none", color: "var(--pink-dark)", textDecoration: "underline", cursor: "pointer", padding: 0, marginTop: 12, minHeight: "auto", fontWeight: 600 }}
        >
          {showAdvanced ? "Hide" : "Show"} advanced settings
        </button>

        {showAdvanced && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Safety %</label>
              <input type="number" step="0.01" value={safetyPct} onChange={e => setSafetyPct(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Coverage months</label>
              <input type="number" step="1" min={1} value={coverageMonths} onChange={e => setCoverageMonths(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Pack size</label>
              <input type="number" step="1" min={1} value={packSize} onChange={e => setPackSize(e.target.value)} />
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button className="primary" onClick={runReport} disabled={!canRun || loading}>
            {loading ? "Running..." : "Run Report"}
          </button>
          <button className="btn" onClick={downloadCsv} disabled={!data?.rows?.length}>
            Export CSV
          </button>
          <button className="btn" onClick={saveAllVisible} disabled={!data?.rows?.length || loading} title="Saves the current agreed stock level for every visible row">
            Save All
          </button>
        </div>

        {error && <div className="small" style={{ color: "var(--red)", marginTop: 10 }}>{error}</div>}
        {!loading && !error && data && customer && (
          <div className="small muted" style={{ marginTop: 10 }}>
            Showing <strong>{(data.rows || []).length}</strong> SKUs for <strong>{customer.name}</strong> / <strong>{data.params.brand}</strong> in{" "}
            <strong>{TF_LABELS[data.params.timeframe as keyof typeof TF_LABELS]}</strong>
          </div>
        )}
      </section>

      {/* Results */}
      {rows.length > 0 && (
        <section className="card">
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th onClick={() => toggleSort("sku")} style={{ cursor: "pointer" }}>SKU {sortKey === "sku" && (sortDir === "asc" ? "\u25B2" : "\u25BC")}</th>
                  <th onClick={() => toggleSort("productName")} style={{ cursor: "pointer" }}>Product {sortKey === "productName" && (sortDir === "asc" ? "\u25B2" : "\u25BC")}</th>
                  <th onClick={() => toggleSort("unitsInWindow")} style={{ cursor: "pointer", textAlign: "center" }}>Units {sortKey === "unitsInWindow" && (sortDir === "asc" ? "\u25B2" : "\u25BC")}</th>
                  <th onClick={() => toggleSort("avgMonthly")} style={{ cursor: "pointer", textAlign: "center" }}>Avg/Mo {sortKey === "avgMonthly" && (sortDir === "asc" ? "\u25B2" : "\u25BC")}</th>
                  <th onClick={() => toggleSort("suggestedMonthlyPAR")} style={{ cursor: "pointer", textAlign: "center" }}>Recommended Stock {sortKey === "suggestedMonthlyPAR" && (sortDir === "asc" ? "\u25B2" : "\u25BC")}</th>
                  <th onClick={() => toggleSort("agreedPar")} style={{ cursor: "pointer", textAlign: "center" }}>Agreed Stock Level {sortKey === "agreedPar" && (sortDir === "asc" ? "\u25B2" : "\u25BC")}</th>
                  <th onClick={() => toggleSort("delta")} style={{ cursor: "pointer", textAlign: "center" }}>Delta {sortKey === "delta" && (sortDir === "asc" ? "\u25B2" : "\u25BC")}</th>
                  <th style={{ textAlign: "center" }}>Set Stock Level</th>
                  <th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => {
                  const editVal = editPar[r.sku] ?? String(r.agreedPar ?? r.suggestedMonthlyPAR ?? 0);
                  const delta = Number(r.delta || 0);
                  const deltaColor = delta > 0 ? "#92400e" : delta < 0 ? "#166534" : "var(--text)";
                  return (
                    <tr key={r.sku || r.productName} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                      <td className="small">{r.sku || <em style={{ color: "var(--muted)" }}>-</em>}</td>
                      <td className="small">{r.productName}</td>
                      <td className="small" style={{ textAlign: "center" }}>{fmt0(r.unitsInWindow)}</td>
                      <td className="small" style={{ textAlign: "center" }}>{fmt2(r.avgMonthly)}</td>
                      <td className="small" style={{ textAlign: "center", fontWeight: 700 }}>{fmt0(r.suggestedMonthlyPAR)}</td>
                      <td className="small" style={{ textAlign: "center" }}>{r.agreedPar != null ? fmt0(r.agreedPar) : "-"}</td>
                      <td className="small" style={{ textAlign: "center", color: deltaColor, fontWeight: 600 }}>{fmt0(delta)}</td>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="number" step="1" min={0} value={editVal}
                          onChange={e => setEdit(r.sku, e.target.value)}
                          style={{ width: 80, height: 34, padding: "4px 8px", textAlign: "center" }}
                        />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn" style={{ fontSize: "0.78rem", padding: "5px 10px" }} onClick={() => saveOne(r.sku)} disabled={!r.sku || !customer?.id}>
                          Save
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!rows.length && !loading && !error && data && (
        <section className="card">
          <p className="small muted" style={{ textAlign: "center", padding: "20px 0" }}>No data for this customer/brand/timeframe combination.</p>
        </section>
      )}

      {!data && !loading && (
        <section className="card">
          <p className="small muted" style={{ textAlign: "center", padding: "20px 0" }}>Choose a customer and brand, then run the report.</p>
        </section>
      )}
    </div>
  );
}
