"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ---- types ---- */
type Rep = { id: string; name: string };
type Vendor = { id: string; name: string };

// By Brand tab
type VendorSpendRow = {
  customerId: string;
  salonName: string;
  salesRep: string | null;
  perVendor: Record<string, number>;
  subtotal: number;
  taxes: number;
  total: number;
};
type VendorSpendResp = { vendors: string[]; rows: VendorSpendRow[] };

// By Product tab
type ProductRow = {
  customerId?: string;
  customerName?: string;
  productId?: string;
  productTitle?: string;
  sku?: string | null;
  qty?: number | null;
  lastOrdered?: string | null;
};

/* ---- helpers ---- */
function fmtMoney(n?: number, currency = "GBP") {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(v);
}

function normalizeVendorNames(json: any): string[] {
  if (Array.isArray(json)) return json.map(String);
  if (Array.isArray(json?.names)) return json.names.map(String);
  if (Array.isArray(json?.vendors)) return json.vendors.map((v: any) => String(v?.name ?? "")).filter(Boolean);
  return [];
}

function vendorSpendCsvHref({ start, end, reps, vendors }: { start?: string | null; end?: string | null; reps: string[]; vendors: string[] }) {
  const qs = new URLSearchParams();
  if (start) { qs.set("start", start); qs.set("from", start); }
  if (end) { qs.set("end", end); qs.set("to", end); }
  if (reps?.length) qs.set("reps", reps.join(","));
  if (vendors?.length) qs.set("vendors", vendors.join(","));
  qs.set("format", "csv");
  return `/api/reports/vendor-spend?${qs.toString()}`;
}

/* ---- MultiSelect component ---- */
function MultiSelect({ label, options, value, onChange, placeholder = "All" }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = options.filter((o) => !q || o.toLowerCase().includes(q.toLowerCase()));
  const allSelected = value.length === 0 || value.length === options.length;
  const summary = allSelected ? `All ${options.length}` : value.length === 1 ? value[0] : `${value.length} selected`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <label className="small" style={{ display: "block", marginBottom: 4 }}>{label}</label>
      <button
        className="btn"
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
        onClick={() => setOpen((x) => !x)}
      >
        <span>{summary}</span>
        <span style={{ fontSize: "0.7rem" }}>▼</span>
      </button>
      {open && (
        <div style={{ position: "absolute", zIndex: 50, top: "100%", left: 0, right: 0, minWidth: 220, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.10)", padding: 10 }}>
          <input autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button className="btn" style={{ fontSize: "0.75rem", padding: "3px 10px" }} onClick={() => onChange([])}>All</button>
            <button className="btn" style={{ fontSize: "0.75rem", padding: "3px 10px" }} onClick={() => onChange(options)}>None</button>
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto", display: "grid", gap: 4 }}>
            {filtered.map((o) => (
              <label key={o} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.875rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={value.length === 0 ? true : value.includes(o)}
                  onChange={(e) => {
                    const base = value.length === 0 ? options : value;
                    onChange(e.target.checked ? [...base, o].filter((x, i, a) => a.indexOf(x) === i) : base.filter((x) => x !== o));
                  }}
                />
                {o}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Main page ---- */
export default function GapAnalysisPage() {
  const [tab, setTab] = useState<"brand" | "product">("brand");
  const [vendors, setVendors] = useState<string[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);

  // By Brand state
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [selReps, setSelReps] = useState<string[]>([]);
  const [selVendors, setSelVendors] = useState<string[]>([]);
  const [brandRows, setBrandRows] = useState<VendorSpendRow[] | null>(null);
  const [brandVendors, setBrandVendors] = useState<string[]>([]);
  const [runningBrand, setRunningBrand] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);

  // By Product state
  const [selVendor, setSelVendor] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<{ id: string; name: string }[]>([]);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [productRows, setProductRows] = useState<ProductRow[] | null>(null);
  const [runningProduct, setRunningProduct] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  /* Load vendors + reps */
  useEffect(() => {
    (async () => {
      setLoadingLists(true);
      try {
        const [vr, rr] = await Promise.all([
          fetch("/api/vendors?context=reports", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/sales-reps", { cache: "no-store" }).then((r) => r.json()).catch(() => []),
        ]);
        const vList = normalizeVendorNames(vr);
        setVendors(vList);
        if (Array.isArray(rr)) setReps(rr);
      } finally {
        setLoadingLists(false);
      }
    })();
  }, []);

  /* Quick date ranges */
  function setRange(days: number | "month" | "year") {
    const now = new Date();
    const e = now.toISOString().slice(0, 10);
    let s: string;
    if (days === "month") {
      s = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    } else if (days === "year") {
      s = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    } else {
      const d = new Date(now); d.setDate(d.getDate() - days);
      s = d.toISOString().slice(0, 10);
    }
    setStart(s); setEnd(e);
  }

  /* Run By Brand */
  async function runBrand() {
    setRunningBrand(true); setBrandError(null);
    try {
      const qs = new URLSearchParams();
      if (start) { qs.set("start", start); qs.set("from", start); }
      if (end) { qs.set("end", end); qs.set("to", end); }
      if (selReps.length) qs.set("reps", selReps.join(","));
      const activeVendors = selVendors.length === 0 ? vendors : selVendors;
      if (activeVendors.length) qs.set("vendors", activeVendors.join(","));
      const r = await fetch(`/api/reports/vendor-spend?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed");
      const resp = j as VendorSpendResp;
      setBrandVendors(resp.vendors || []);
      setBrandRows(resp.rows || []);
    } catch (e: any) {
      setBrandError(e.message || "Failed");
    } finally {
      setRunningBrand(false);
    }
  }

  /* Customer search for By Product tab */
  async function searchCustomers(q: string) {
    if (!q.trim()) { setCustomerResults([]); return; }
    try {
      const r = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const j = await r.json();
      const arr = Array.isArray(j) ? j : (j?.customers || j?.items || j?.rows || []);
      setCustomerResults(arr.map((x: any) => ({
        id: String(x?.id || x?.customerId || ""),
        name: String(x?.salonName || x?.name || x?.customerName || ""),
      })).filter((x: any) => x.id && x.name));
    } catch { setCustomerResults([]); }
  }

  useEffect(() => {
    const t = setTimeout(() => searchCustomers(customerQuery), 300);
    return () => clearTimeout(t);
  }, [customerQuery]);

  /* Run By Product */
  async function runProduct() {
    if (!selVendor) { setProductError("Please select a brand first"); return; }
    setRunningProduct(true); setProductError(null);
    try {
      const r = await fetch("/api/reports/gap-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor: selVendor, since: since || null, until: until || null, customerIds: customerId ? [customerId] : [] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed");
      setProductRows(Array.isArray(j?.rows) ? j.rows : Array.isArray(j) ? j : []);
    } catch (e: any) {
      setProductError(e.message || "Failed");
    } finally {
      setRunningProduct(false);
    }
  }

  /* Group product rows by product */
  const productsByTitle = useMemo(() => {
    if (!productRows) return [];
    const map = new Map<string, { title: string; sku: string | null; buyers: string[]; nonBuyers: string[] }>();
    for (const r of productRows) {
      const key = r.productTitle || r.sku || "Unknown";
      if (!map.has(key)) map.set(key, { title: r.productTitle || key, sku: r.sku || null, buyers: [], nonBuyers: [] });
      const entry = map.get(key)!;
      const name = r.customerName || "Unknown";
      if (r.qty && r.qty > 0) entry.buyers.push(name);
      else entry.nonBuyers.push(name);
    }
    return Array.from(map.values()).sort((a, b) => b.buyers.length - a.buyers.length);
  }, [productRows]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>GAP Analysis</h1>
        <p className="small muted">See which customers are buying which brands and products — and who's missing out.</p>
      </section>

      {/* Tab switcher */}
      <section className="card">
        <div style={{ display: "flex", gap: 8 }}>
          <button className={tab === "brand" ? "chip primary" : "chip"} onClick={() => setTab("brand")}>
            By Brand
          </button>
          <button className={tab === "product" ? "chip primary" : "chip"} onClick={() => setTab("product")}>
            By Product
          </button>
        </div>
      </section>

      {/* ===== BY BRAND TAB ===== */}
      {tab === "brand" && (
        <>
          <section className="card">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 12 }}>
              <div className="field"><label>Start date</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div className="field"><label>End date</label><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
              {!loadingLists && reps.length > 0 && (
                <MultiSelect label="Sales Reps" options={reps.map((r) => r.name)} value={selReps} onChange={setSelReps} />
              )}
              {!loadingLists && vendors.length > 0 && (
                <MultiSelect label="Brands" options={vendors} value={selVendors} onChange={setSelVendors} />
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="small muted">Quick:</span>
              {[["7d","Last 7 days"],["30d","Last 30 days"],["month","Month to date"],["year","Year to date"]].map(([k,l]) => (
                <button key={k} className="btn" style={{ fontSize: "0.8rem" }} onClick={() => setRange(k === "month" ? "month" : k === "year" ? "year" : parseInt(k))}>
                  {l}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
              <button className="primary" onClick={runBrand} disabled={runningBrand || loadingLists}>
                {runningBrand ? "Running…" : "Run Report"}
              </button>
              {brandRows && (
                <a className="btn" style={{ fontSize: "0.85rem" }} href={vendorSpendCsvHref({ start, end, reps: selReps, vendors: selVendors.length ? selVendors : vendors })}>
                  Export CSV
                </a>
              )}
            </div>
            {brandError && <div className="small" style={{ color: "#dc2626", marginTop: 8 }}>{brandError}</div>}
          </section>

          {brandRows && brandRows.length === 0 && (
            <section className="card"><p className="small muted">No data for the selected filters.</p></section>
          )}

          {brandRows && brandRows.length > 0 && (
            <section className="card" style={{ overflowX: "auto" }}>
              <p className="small muted" style={{ marginBottom: 12 }}>{brandRows.length} customers</p>
              <table className="table" style={{ minWidth: 600 }}>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Rep</th>
                    {brandVendors.map((v) => <th key={v} style={{ textAlign: "right" }}>{v}</th>)}
                    <th style={{ textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {brandRows.map((row) => (
                    <tr key={row.customerId}>
                      <td className="small"><a href={`/customers/${row.customerId}`} style={{ color: "inherit" }}>{row.salonName}</a></td>
                      <td className="small">{row.salesRep || "—"}</td>
                      {brandVendors.map((v) => (
                        <td key={v} className="small" style={{ textAlign: "right", color: row.perVendor[v] ? "inherit" : "#ccc" }}>
                          {row.perVendor[v] ? fmtMoney(row.perVendor[v]) : "—"}
                        </td>
                      ))}
                      <td className="small" style={{ textAlign: "right", fontWeight: 600 }}>{fmtMoney(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {/* ===== BY PRODUCT TAB ===== */}
      {tab === "product" && (
        <>
          <section className="card">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 12 }}>
              <div className="field">
                <label>Brand *</label>
                <select value={selVendor} onChange={(e) => { setSelVendor(e.target.value); setProductRows(null); }}>
                  <option value="">— Select brand —</option>
                  {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="field"><label>Since</label><input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></div>
              <div className="field"><label>Until</label><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
              <div className="field" style={{ position: "relative" }}>
                <label>Filter by customer (optional)</label>
                <input
                  value={customerQuery}
                  onChange={(e) => { setCustomerQuery(e.target.value); setCustomerOpen(true); if (!e.target.value) { setCustomerId(""); } }}
                  placeholder="Search salon…"
                />
                {customerOpen && customerResults.length > 0 && (
                  <div style={{ position: "absolute", zIndex: 50, top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.10)", maxHeight: 200, overflowY: "auto" }}>
                    {customerResults.map((c) => (
                      <div key={c.id} style={{ padding: "8px 12px", cursor: "pointer", fontSize: "0.875rem" }}
                        onClick={() => { setCustomerId(c.id); setCustomerQuery(c.name); setCustomerOpen(false); }}>
                        {c.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button className="primary" onClick={runProduct} disabled={runningProduct || !selVendor || loadingLists}>
                {runningProduct ? "Running…" : "Run Report"}
              </button>
              {customerId && <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => { setCustomerId(""); setCustomerQuery(""); }}>Clear customer</button>}
            </div>
            {productError && <div className="small" style={{ color: "#dc2626", marginTop: 8 }}>{productError}</div>}
          </section>

          {!selVendor && !loadingLists && (
            <section className="card">
              <p className="small muted">Select a brand above to see product-level gap analysis.</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {vendors.map((v) => (
                  <button key={v} className="btn" style={{ fontSize: "0.85rem" }} onClick={() => setSelVendor(v)}>{v}</button>
                ))}
              </div>
            </section>
          )}

          {productRows && productsByTitle.length === 0 && (
            <section className="card"><p className="small muted">No data found for this brand and date range.</p></section>
          )}

          {productsByTitle.length > 0 && (
            <div style={{ display: "grid", gap: 12 }}>
              {productsByTitle.map((p) => (
                <section key={p.title} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{p.title}</div>
                      {p.sku && <div className="small muted">SKU: {p.sku}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ padding: "3px 12px", borderRadius: 999, fontSize: "0.75rem", fontWeight: 600, background: "#dcfce7" }}>
                        {p.buyers.length} buying
                      </span>
                      <span style={{ padding: "3px 12px", borderRadius: 999, fontSize: "0.75rem", fontWeight: 600, background: "#fee2e2" }}>
                        {p.nonBuyers.length} not buying
                      </span>
                    </div>
                  </div>
                  {p.nonBuyers.length > 0 && (
                    <div>
                      <div className="small" style={{ fontWeight: 600, marginBottom: 4, color: "#dc2626" }}>Not buying:</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {p.nonBuyers.map((n) => (
                          <span key={n} style={{ padding: "2px 10px", borderRadius: 999, fontSize: "0.75rem", background: "#fee2e2", border: "1px solid #fecaca" }}>{n}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.buyers.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div className="small" style={{ fontWeight: 600, marginBottom: 4, color: "#16a34a" }}>Buying:</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {p.buyers.map((n) => (
                          <span key={n} style={{ padding: "2px 10px", borderRadius: 999, fontSize: "0.75rem", background: "#dcfce7", border: "1px solid #bbf7d0" }}>{n}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
