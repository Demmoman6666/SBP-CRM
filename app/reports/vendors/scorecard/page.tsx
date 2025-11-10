// app/reports/vendors/scorecard/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ScoreRow = {
  vendor: string;
  revenue: number;
  orders: number;
  customers: number;
  aov: number;
  prevRevenue: number;
  growthPct: number | null;
};
type ApiResp = {
  params: {
    start: string | null;
    end: string | null;
    vendors: string[];
    reps: string[];
    prevRange?: { start: string; end: string };
  };
  summary: { revenue: number; orders: number; customers: number };
  byVendor: ScoreRow[];
  timeseries: { period: string; vendor: string; revenue: number }[];
};

type Rep = { id: string; name: string };

function fmtMoney(n: number, c = "GBP") {
  if (!Number.isFinite(n)) n = 0;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${c} ${n.toFixed(2)}`;
  }
}
function fmtPct(p: number | null) {
  if (p === null || !Number.isFinite(p)) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
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
            <button className="chip" onClick={() => onChange(options)}>All</button>
            <button className="chip" onClick={() => onChange([])}>None</button>
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
  const router = useRouter();

  // Filters
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);

  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  const [vendorSel, setVendorSel] = useState<string[]>([]);

  const [repOptions, setRepOptions] = useState<string[]>([]);
  const [repSel, setRepSel] = useState<string[]>([]);

  // Data
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<ApiResp | null>(null);

  // Bootstrap: vendors + reps
  useEffect(() => {
    (async () => {
      try {
        const [vendorsRes, repsRes] = await Promise.all([
          fetch("/api/vendors", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ names: [] })),
          fetch("/api/sales-reps", { cache: "no-store" }).then((r) => r.json()).catch(() => [] as Rep[]),
        ]);

        const vendorNames: string[] = Array.isArray(vendorsRes?.names)
          ? vendorsRes.names
          : Array.isArray(vendorsRes)
          ? vendorsRes
          : Array.isArray(vendorsRes?.vendors)
          ? vendorsRes.vendors.map((v: any) => v?.name).filter(Boolean)
          : [];

        const reps: Rep[] = Array.isArray(repsRes) ? repsRes : [];
        const repNames = reps.map((r) => r.name).filter(Boolean);

        vendorNames.sort((a, b) => a.localeCompare(b));
        repNames.sort((a, b) => a.localeCompare(b));

        setVendorOptions(vendorNames);
        setVendorSel(vendorNames); // default: all vendors
        setRepOptions(repNames);
        setRepSel(repNames); // default: all reps
      } catch {
        setVendorOptions([]);
        setVendorSel([]);
        setRepOptions([]);
        setRepSel([]);
      }
    })();
  }, []);

  function quick(kind: "wtd" | "mtd" | "ytd" | "clear") {
    const now = new Date();
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
      if (repSel.length) qs.set("reps", repSel.join(","));
      const r = await fetch(`/api/reports/vendor-scorecard?${qs.toString()}`, { cache: "no-store" });
      const j = (await r.json()) as ApiResp;
      setResp(j);
    } finally {
      setLoading(false);
    }
  }

  const totalVendors = resp?.byVendor?.length ?? 0;

  const gotoOrders = (vendor: string) => {
    const qs = new URLSearchParams({ vendor, start: start ?? "", end: end ?? "" });
    router.push(`/reports/vendors/orders?${qs.toString()}`);
  };

  const gotoCustomers = (vendor: string) => {
    const qs = new URLSearchParams({ vendor, start: start ?? "", end: end ?? "" });
    router.push(`/reports/vendors/customers?${qs.toString()}`);
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Vendor Scorecard</h1>
        <p className="small">Filter by date, vendor(s), and sales rep(s). Growth compares to the previous equal-length period.</p>
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
          <MultiSelect
            label="Sales Reps"
            options={repOptions}
            value={repSel}
            onChange={setRepSel}
            placeholder="All reps"
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
              <b style={{ fontSize: 18 }}>{fmtMoney(resp.summary.revenue)}</b>
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
              gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr 1fr",
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
            <div>Growth</div>
          </div>

          {resp.byVendor.map((r) => {
            const growth = r.growthPct;
            const color =
              growth === null ? undefined : growth > 0 ? "#15803d" : growth < 0 ? "#b91c1c" : undefined;
            return (
              <div
                key={r.vendor}
                className="small"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr 1fr",
                  columnGap: 12,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div>{r.vendor}</div>
                <div>{fmtMoney(r.revenue)}</div>
                <div>
                  <button
                    type="button"
                    onClick={() => gotoOrders(r.vendor)}
                    className="link"
                    title="View orders for this vendor in the selected range"
                    style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline" }}
                  >
                    {r.orders.toLocaleString()}
                  </button>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => gotoCustomers(r.vendor)}
                    className="link"
                    title="View customers who bought from this vendor in the selected range"
                    style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline" }}
                  >
                    {r.customers.toLocaleString()}
                  </button>
                </div>
                <div>{fmtMoney(r.aov)}</div>
                <div style={{ color }}>{fmtPct(growth)}</div>
              </div>
            );
          })}
        </section>
      )}

      {/* Trend */}
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
                      <div key={p}>{fmtMoney(map.get(`${v}|${p}`) || 0)}</div>
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
