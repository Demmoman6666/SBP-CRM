// app/reports/vendors/scorecard/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ScoreRow = { vendor: string; revenue: number; orders: number; customers: number; aov: number };
type ApiResp = {
  params: { start: string | null; end: string | null; vendors: string[] };
  summary: { revenue: number; orders: number; customers: number };
  byVendor: ScoreRow[];
  timeseries: { period: string; vendor: string; revenue: number }[];
};

function fmt(n: number, c = "GBP") {
  if (!Number.isFinite(n)) n = 0;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${c} ${n.toFixed(2)}`;
  }
}

function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "All",
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

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => o.toLowerCase().includes(s));
  }, [options, q]);

  const summary =
    value.length === 0
      ? placeholder
      : value.length === options.length
      ? `All ${options.length}`
      : value.slice(0, 3).join(", ") + (value.length > 3 ? ` +${value.length - 3}` : "");

  return (
    <div ref={ref} className="field" style={{ position: "relative", minWidth: 280 }}>
      <label>{label}</label>
      <button type="button" className="input" onClick={() => setOpen((v) => !v)} style={{ textAlign: "left" }}>
        {summary}
      </button>
      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            zIndex: 40,
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 6,
            padding: 10,
            border: "1px solid var(--border)",
            background: "#fff",
            maxHeight: 320,
            overflow: "auto",
          }}
        >
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="chip" onClick={() => onChange(options)}>
              All
            </button>
            <button className="chip" onClick={() => onChange([])}>
              None
            </button>
          </div>
          <div className="grid" style={{ gap: 6 }}>
            {filtered.map((opt) => {
              const checked = value.includes(opt);
              return (
                <label key={opt} className="row small" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked ? [...value, opt] : value.filter((v) => v !== opt))}
                  />
                  {opt}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function VendorScorecardPage() {
  // Filters
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  const [vendorSel, setVendorSel] = useState<string[]>([]);

  // Data
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<ApiResp | null>(null);

  // Bootstrap: load vendors from /api/vendors (supports both {names:[]} and {vendors:[{name}]})
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/vendors", { cache: "no-store" });
        const j = await r.json();
        const names: string[] = Array.isArray(j?.names)
          ? j.names
          : Array.isArray(j?.vendors)
          ? j.vendors.map((v: any) => v?.name).filter(Boolean)
          : [];
        names.sort((a, b) => a.localeCompare(b));
        setVendorOptions(names);
        setVendorSel(names); // default: all vendors
      } catch {
        setVendorOptions([]);
        setVendorSel([]);
      }
    })();
  }, []);

  function quick(kind: "wtd" | "mtd" | "ytd" | "clear") {
    const now = new Date();
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (kind === "clear") {
      setStart(null);
      setEnd(null);
      return;
    }
    if (kind === "wtd") {
      const d = new Date(now);
      const diff = (d.getDay() + 6) % 7; // Mon=0
      d.setDate(d.getDate() - diff);
      setStart(ymd(d));
      setEnd(ymd(now));
    } else if (kind === "mtd") {
      setStart(ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
      setEnd(ymd(now));
    } else if (kind === "ytd") {
      setStart(ymd(new Date(now.getFullYear(), 0, 1)));
      setEnd(ymd(now));
    }
  }

  async function run() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (start) qs.set("start", start);
      if (end) qs.set("end", end);
      if (vendorSel.length) qs.set("vendors", vendorSel.join(","));
      const r = await fetch(`/api/reports/vendor-scorecard?${qs.toString()}`, { cache: "no-store" });
      const j = (await r.json()) as ApiResp;
      setResp(j);
    } finally {
      setLoading(false);
    }
  }

  const totalVendors = resp?.byVendor?.length ?? 0;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Vendor Scorecard</h1>
        <p className="small">Revenue, orders, customers and AOV per vendor, with a monthly trend.</p>
      </section>

      {/* Filters */}
      <section className="card grid" style={{ gap: 12, overflow: "visible" }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field">
            <label>Start</label>
            <input type="date" value={start ?? ""} onChange={(e) => setStart(e.target.value || null)} />
          </div>
          <div className="field">
            <label>End</label>
            <input type="date" value={end ?? ""} onChange={(e) => setEnd(e.target.value || null)} />
          </div>

          <div className="row small" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="muted">Quick:</span>
            <button className="chip" onClick={() => quick("wtd")}>Week to date</button>
            <button className="chip" onClick={() => quick("mtd")}>Month to date</button>
            <button className="chip" onClick={() => quick("ytd")}>Year to date</button>
            <button className="chip" onClick={() => quick("clear")}>Clear</button>
          </div>
        </div>

        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <MultiSelect
            label="Vendors"
            options={vendorOptions}
            value={vendorSel}
            onChange={setVendorSel}
            placeholder="All vendors"
          />
        </div>

        <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button className="primary" onClick={run} disabled={loading}>
            {loading ? "Loading…" : "Run"}
          </button>
        </div>
      </section>

      {/* Summary */}
      {resp && (
        <section className="card">
          <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            <div className="card" style={{ padding: 12 }}>
              <div className="small muted">Vendors</div>
              <b style={{ fontSize: 18 }}>{totalVendors}</b>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="small muted">Revenue</div>
              <b style={{ fontSize: 18 }}>{fmt(resp.summary.revenue)}</b>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="small muted">Orders</div>
              <b style={{ fontSize: 18 }}>{resp.summary.orders.toLocaleString()}</b>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="small muted">Customers</div>
              <b style={{ fontSize: 18 }}>{resp.summary.customers.toLocaleString()}</b>
            </div>
          </div>
        </section>
      )}

      {/* Table */}
      {resp && resp.byVendor.length > 0 && (
        <section className="card" style={{ overflowX: "auto" }}>
          <div
            className="small"
            style={{
              display: "grid",
              gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr",
              columnGap: 12,
              fontWeight: 600,
              paddingBottom: 8,
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div>Vendor</div>
            <div>Revenue</div>
            <div>Orders</div>
            <div>Customers</div>
            <div>AOV</div>
          </div>

          {resp.byVendor.map((r) => (
            <div
              key={r.vendor}
              className="small"
              style={{
                display: "grid",
                gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr",
                columnGap: 12,
                padding: "8px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div>{r.vendor}</div>
              <div>{fmt(r.revenue)}</div>
              <div>{r.orders.toLocaleString()}</div>
              <div>{r.customers.toLocaleString()}</div>
              <div>{fmt(r.aov)}</div>
            </div>
          ))}
        </section>
      )}

      {/* Trend (simple monthly matrix) */}
      {resp && resp.timeseries.length > 0 && (
        <section className="card" style={{ overflowX: "auto" }}>
          <h3 className="small" style={{ marginBottom: 8 }}>Monthly Trend</h3>
          {(() => {
            const periods = Array.from(new Set(resp.timeseries.map((t) => t.period))).sort();
            const vendors = Array.from(new Set(resp.timeseries.map((t) => t.vendor)));
            const map = new Map<string, number>();
            for (const t of resp.timeseries) map.set(`${t.vendor}|${t.period}`, t.revenue);

            return (
              <div>
                <div
                  className="small"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `1.2fr ${periods.map(() => "1fr").join(" ")}`,
                    columnGap: 12,
                    fontWeight: 600,
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div>Vendor</div>
                  {periods.map((p) => (
                    <div key={p}>{p}</div>
                  ))}
                </div>
                {vendors.map((v) => (
                  <div
                    key={v}
                    className="small"
                    style={{
                      display: "grid",
                      gridTemplateColumns: `1.2fr ${periods.map(() => "1fr").join(" ")}`,
                      columnGap: 12,
                      padding: "8px 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <div>{v}</div>
                    {periods.map((p) => (
                      <div key={p}>{fmt(map.get(`${v}|${p}`) || 0)}</div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })()}
        </section>
      )}
    </div>
  );
}
