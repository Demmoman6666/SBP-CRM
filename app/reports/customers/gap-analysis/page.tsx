// app/reports/customers/gap-analysis/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Rep = { id: string; name: string };

type ApiRow = {
  customerId: string;
  salonName: string;
  salesRep: string | null;
  perVendor?: Record<string, number>;
  vendors?: Record<string, number>;
  subtotal: number;
  taxes: number;
  total: number;
};
type ApiResp = { vendors: string[]; rows: ApiRow[] };

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const fmtMoney = (n?: number) => (n ? GBP.format(n) : "—");

const pad2 = (n: number) => String(n).padStart(2, "0");
const toDMY = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
function startOfWeekMonday(d: Date) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const dow = x.getDay(); const diff = (dow + 6) % 7; x.setDate(x.getDate() - diff); return x; }
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfYear(d: Date) { return new Date(d.getFullYear(), 0, 1); }

/** Lightweight multi-select dropdown with checkboxes */
function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "Select…",
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter(o => o.toLowerCase().includes(s));
  }, [options, q]);

  const summary = value.length === 0
    ? placeholder
    : value.length === options.length
    ? `All (${options.length})`
    : value.slice(0, 3).join(", ") + (value.length > 3 ? ` +${value.length - 3}` : "");

  return (
    <div ref={ref} className="field" style={{ position: "relative", minWidth: 280 }}>
      <label>{label}</label>
      <button
        type="button"
        className="input"
        onClick={() => setOpen(v => !v)}
        style={{ textAlign: "left", display: "flex", justifyContent: "space-between" }}
      >
        <span className={value.length ? "" : "muted"}>{summary}</span>
        <span className="muted">▾</span>
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 6,
            padding: 8,
            border: "1px solid var(--border)",
            maxHeight: 320,
            overflow: "auto",
          }}
        >
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <input
              className="input"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="chip"
              onClick={() => onChange(options)}
              title="Select all"
            >
              All
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => onChange([])}
              title="Clear all"
            >
              None
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="small muted">No matches.</div>
          ) : (
            <div className="grid" style={{ gap: 6 }}>
              {filtered.map((opt) => {
                const checked = value.includes(opt);
                return (
                  <label key={opt} className="row small" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        onChange(
                          e.target.checked
                            ? [...value, opt]
                            : value.filter((v) => v !== opt)
                        )
                      }
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function GapAnalysisPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [reps, setReps] = useState<Rep[]>([]);
  const [repSel, setRepSel] = useState<string[]>([]);

  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  const [vendorSel, setVendorSel] = useState<string[]>([]);

  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncingVendors, setSyncingVendors] = useState(false);

  // load reps
  useEffect(() => {
    fetch("/api/sales-reps")
      .then((r) => r.json())
      .then((arr: Rep[]) => {
        setReps(arr || []);
        setRepSel((arr || []).map((r) => r.name)); // default all
      })
      .catch(() => setReps([]));
  }, []);

  // load vendor options from StockedBrand
  async function loadVendors() {
    const res = await fetch("/api/stocked-brands");
    const json = await res.json();
    const list: string[] = (json?.vendors ?? []).filter(Boolean);
    list.sort((a, b) => a.localeCompare(b));
    setVendorOptions(list);
    setVendorSel(list); // default all
  }
  useEffect(() => { loadVendors(); }, []);

  async function run() {
    setLoading(true);
    try {
      const qp = new URLSearchParams();
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

  const VENDORS = useMemo(() => data?.vendors ?? vendorOptions, [data?.vendors, vendorOptions]);

  async function refreshVendorsFromShopify() {
    setSyncingVendors(true);
    try {
      // crawl Shopify products -> StockedBrand
      await fetch("/api/stocked-brands", { method: "POST" });
      await loadVendors(); // reload
    } finally {
      setSyncingVendors(false);
    }
  }

  // dynamic columns
  const gridCols = useMemo(() => {
    const vendorCols = (data?.vendors ?? []).map(() => "140px").join(" ");
    return `minmax(220px,1.3fr) 160px ${vendorCols} 120px 120px 120px`;
  }, [data?.vendors]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>GAP Analysis</h1>
        <p className="small">See spend by vendor per customer. Filter by sales rep, vendor, and date range.</p>
      </section>

      <section className="card grid" style={{ gap: 12 }}>
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

        <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button className="primary" onClick={run} disabled={loading}>
            {loading ? "Running…" : "Run"}
          </button>
          <button
            type="button"
            className="chip"
            onClick={refreshVendorsFromShopify}
            disabled={syncingVendors}
            title="Pull vendors from Shopify products and update list"
          >
            {syncingVendors ? "Refreshing vendors…" : "Refresh vendors (Shopify)"}
          </button>
        </div>

        {/* Multi-selects */}
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <MultiSelect
            label="Sales Reps"
            options={reps.map(r => r.name)}
            value={repSel}
            onChange={setRepSel}
            placeholder="All reps"
          />
          <MultiSelect
            label="Vendors"
            options={vendorOptions}
            value={vendorSel}
            onChange={setVendorSel}
            placeholder="All vendors"
          />
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
              {VENDORS.map((v) => <div key={v}>{v}</div>)}
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
                  {VENDORS.map((v) => <div key={v}>{fmtMoney(per[v])}</div>)}
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
