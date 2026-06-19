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
    <div ref={ref} style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
      <label className="small" style={{ display: "block", marginBottom: 4 }}>{label}</label>
      <button
        className="btn"
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
        onClick={() => setOpen((x) => !x)}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        <span style={{ fontSize: "0.7rem", flexShrink: 0 }}>▼</span>
      </button>
      {open && (
        <div
          style={{ position: "fixed", zIndex: 200, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.15)", padding: 10, overflowY: "auto" }}
          ref={(el) => {
            if (!el || !ref.current) return;
            const btnRect = ref.current.getBoundingClientRect();
            const isMobile = window.innerWidth < 640;
            if (isMobile) {
              el.style.left = "12px";
              el.style.right = "12px";
              el.style.top = "max(12px, env(safe-area-inset-top))";
              el.style.bottom = "max(12px, env(safe-area-inset-bottom))";
              el.style.maxHeight = "none";
              el.style.minWidth = "0";
            } else {
              const spaceBelow = window.innerHeight - btnRect.bottom;
              const spaceAbove = btnRect.top;
              el.style.left = btnRect.left + "px";
              el.style.minWidth = Math.max(220, btnRect.width) + "px";
              el.style.right = "auto";
              if (spaceBelow >= 280 || spaceBelow >= spaceAbove) {
                el.style.top = (btnRect.bottom + 6) + "px";
                el.style.bottom = "auto";
                el.style.maxHeight = Math.min(320, spaceBelow - 16) + "px";
              } else {
                el.style.bottom = (window.innerHeight - btnRect.top + 6) + "px";
                el.style.top = "auto";
                el.style.maxHeight = Math.min(320, spaceAbove - 16) + "px";
              }
            }
          }}
        >
          <input autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button className="btn" style={{ fontSize: "0.75rem", padding: "3px 10px" }} onClick={() => onChange([])}>All</button>
            <button className="btn" style={{ fontSize: "0.75rem", padding: "3px 10px" }} onClick={() => onChange(options)}>None</button>
          </div>
          <div style={{ display: "grid", gap: 4 }}>
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
  const [productData, setProductData] = useState<any>(null);
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
        name: String(x?.label || x?.salonName || x?.name || x?.customerName || ""),
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
      setProductData(j);
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
            <section className="card">
              <p className="small muted" style={{ marginBottom: 12 }}>{brandRows.length} customers</p>
              <div className="table-wrap">
                <table className="table" style={{ minWidth: Math.max(600, brandVendors.length * 160 + 300) }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 180 }}>Customer</th>
                      <th style={{ minWidth: 120 }}>Rep</th>
                      {brandVendors.map((v) => (
                        <th key={v} style={{ textAlign: "right", minWidth: 140, background: "#FEF0F9", borderLeft: "2px solid #FEB3E4" }}>{v}</th>
                      ))}
                      <th style={{ textAlign: "right", minWidth: 120, background: "#F1F5F9", borderLeft: "2px solid #CBD5E1" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brandRows.map((row, i) => (
                      <tr key={row.customerId}>
                        <td style={{ fontWeight: 500 }}>
                          <a href={`/customers/${row.customerId}`} style={{ color: "inherit", textDecoration: "none" }}>{row.salonName}</a>
                        </td>
                        <td style={{ color: "var(--muted)" }}>{row.salesRep || "—"}</td>
                        {brandVendors.map((v) => (
                          <td key={v} style={{
                            textAlign: "right",
                            borderLeft: "2px solid #FEB3E4",
                            background: row.perVendor[v] ? (i % 2 === 0 ? "#FFF5FC" : "#FEF0F9") : (i % 2 === 0 ? "#FAFAFA" : "#F5F5F5"),
                            color: row.perVendor[v] ? "var(--text)" : "#CCC",
                            fontWeight: row.perVendor[v] ? 500 : 400,
                          }}>
                            {row.perVendor[v] ? fmtMoney(row.perVendor[v]) : "—"}
                          </td>
                        ))}
                        <td style={{
                          textAlign: "right",
                          fontWeight: 700,
                          borderLeft: "2px solid #CBD5E1",
                          background: i % 2 === 0 ? "#F8FAFC" : "#F1F5F9",
                        }}>
                          {fmtMoney(row.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid var(--border-dark)" }}>
                      <td style={{ fontWeight: 700, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Totals</td>
                      <td></td>
                      {brandVendors.map((v) => {
                        const total = brandRows.reduce((s, r) => s + (r.perVendor[v] || 0), 0);
                        return (
                          <td key={v} style={{ textAlign: "right", fontWeight: 700, borderLeft: "2px solid #FEB3E4", background: "#FEF0F9" }}>
                            {total > 0 ? fmtMoney(total) : "—"}
                          </td>
                        );
                      })}
                      <td style={{ textAlign: "right", fontWeight: 700, borderLeft: "2px solid #CBD5E1", background: "#F1F5F9" }}>
                        {fmtMoney(brandRows.reduce((s, r) => s + (r.total || 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
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
                <select value={selVendor} onChange={(e) => { setSelVendor(e.target.value); setProductRows(null); setProductData(null); }}>
                  <option value="">— Select brand —</option>
                  {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="field"><label>Since</label><input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></div>
              <div className="field"><label>Until</label><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
              <div className="field" id="gap-customer-search-field" style={{ position: "relative" }}>
                <label>Filter by customer (optional)</label>
                <input
                  value={customerQuery}
                  onChange={(e) => {
                    setCustomerQuery(e.target.value);
                    setCustomerOpen(true);
                    if (!e.target.value) setCustomerId("");
                  }}
                  placeholder="Type to search salons..."
                />
                {customerOpen && customerResults.length > 0 && (
                  <div
                    style={{ position: "fixed", zIndex: 200, background: "#fff", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.15)", overflowY: "auto" }}
                    ref={(el) => {
                      if (!el) return;
                      const fieldEl = document.getElementById("gap-customer-search-field");
                      if (!fieldEl) return;
                      const rect = fieldEl.getBoundingClientRect();
                      const isMobile = window.innerWidth < 640;
                      if (isMobile) {
                        el.style.left = "12px";
                        el.style.right = "12px";
                        el.style.top = "max(12px, env(safe-area-inset-top))";
                        el.style.bottom = "max(12px, env(safe-area-inset-bottom))";
                        el.style.maxHeight = "none";
                      } else {
                        const spaceBelow = window.innerHeight - rect.bottom;
                        const spaceAbove = rect.top;
                        el.style.left = rect.left + "px";
                        el.style.width = rect.width + "px";
                        el.style.right = "auto";
                        if (spaceBelow >= 240 || spaceBelow >= spaceAbove) {
                          el.style.top = (rect.bottom + 4) + "px";
                          el.style.bottom = "auto";
                          el.style.maxHeight = Math.min(240, spaceBelow - 16) + "px";
                        } else {
                          el.style.bottom = (window.innerHeight - rect.top + 4) + "px";
                          el.style.top = "auto";
                          el.style.maxHeight = Math.min(240, spaceAbove - 16) + "px";
                        }
                      }
                    }}
                  >
                    {customerResults.map((c) => (
                      <div
                        key={c.id}
                        style={{ padding: "10px 14px", cursor: "pointer", fontSize: "0.875rem", borderBottom: "1px solid var(--border)" }}
                        onMouseDown={() => { setCustomerId(c.id); setCustomerQuery(c.name); setCustomerOpen(false); }}
                      >
                        {c.name}
                      </div>
                    ))}
                  </div>
                )}
                {customerId && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: "0.75rem", background: "var(--pink-light)", color: "var(--pink-dark)", padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
                      ✓ {customerQuery}
                    </span>
                    <button className="btn" style={{ fontSize: "0.75rem", padding: "2px 8px", minHeight: "unset" }}
                      onClick={() => { setCustomerId(""); setCustomerQuery(""); }}>✕</button>
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button className="primary" onClick={runProduct} disabled={runningProduct || !selVendor || loadingLists}>
                {runningProduct ? "Running…" : "Run Report"}
              </button>
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

          {productData && productData?.products?.length === 0 && (
            <section className="card"><p className="small muted">No data found for this brand and date range.</p></section>
          )}

          {productData && productData?.products?.length > 0 && (() => {
            const data = productData;
            const products: { id: number; title: string; sku: string | null }[] = data.products || [];
            const customers: { customerId: string; customerName: string; products: { productId: number; bought: boolean }[]; boughtCount: number; gapCount: number }[] = data.customers || [];

            return (
              <section className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{selVendor}</div>
                    <div className="small muted">{products.length} products · {customers.length} customers</div>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="table" style={{ minWidth: Math.max(500, customers.length * 130 + 220) }}>
                    <thead>
                      <tr>
                        <th style={{ minWidth: 200, position: "sticky", left: 0, background: "var(--surface-2)", zIndex: 2 }}>Product</th>
                        <th style={{ minWidth: 60, textAlign: "center" }}>SKU</th>
                        {customers.map((c) => (
                          <th key={c.customerId} style={{ minWidth: 120, textAlign: "center", fontSize: "0.7rem" }}>
                            {c.customerName}
                          </th>
                        ))}
                        <th style={{ minWidth: 80, textAlign: "center", background: "var(--surface-2)" }}>Buying</th>
                        <th style={{ minWidth: 80, textAlign: "center", background: "#FEF2F2" }}>Gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p, pi) => {
                        const buyingCount = customers.filter(c => c.products.find(cp => cp.productId === p.id)?.bought).length;
                        const gapCount = customers.length - buyingCount;
                        return (
                          <tr key={p.id}>
                            <td style={{ fontWeight: 600, position: "sticky", left: 0, background: pi % 2 === 0 ? "#fff" : "#FAFBFC", zIndex: 1 }}>
                              {p.title}
                            </td>
                            <td style={{ textAlign: "center", color: "var(--muted)", fontSize: "0.75rem" }}>{p.sku || "—"}</td>
                            {customers.map((c) => {
                              const bought = c.products.find(cp => cp.productId === p.id)?.bought ?? false;
                              return (
                                <td key={c.customerId} style={{ textAlign: "center", padding: "10px 8px" }}>
                                  {bought
                                    ? <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "#DCFCE7", color: "#16A34A", fontSize: "0.8rem", fontWeight: 700 }}>✓</span>
                                    : <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "#FEE2E2", color: "#DC2626", fontSize: "0.8rem", fontWeight: 700 }}>✕</span>
                                  }
                                </td>
                              );
                            })}
                            <td style={{ textAlign: "center", fontWeight: 700, color: "#16A34A", background: "#F0FDF4" }}>{buyingCount}</td>
                            <td style={{ textAlign: "center", fontWeight: 700, color: "#DC2626", background: "#FEF2F2" }}>{gapCount}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: "2px solid var(--border-dark)" }}>
                        <td style={{ fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em", position: "sticky", left: 0, background: "var(--surface-2)" }}>Totals</td>
                        <td></td>
                        {customers.map((c) => (
                          <td key={c.customerId} style={{ textAlign: "center", fontWeight: 700, fontSize: "0.8rem" }}>
                            <div style={{ color: "#16A34A" }}>{c.boughtCount}✓</div>
                            <div style={{ color: "#DC2626" }}>{c.gapCount}✕</div>
                          </td>
                        ))}
                        <td></td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            );
          })()}
        </>
      )}
    </div>
  );
}
