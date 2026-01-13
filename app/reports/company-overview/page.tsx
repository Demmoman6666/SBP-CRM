// app/reports/company-overview/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* ---------- Types ---------- */
type ApiOne = {
  ok: boolean;
  range: { from: string; to: string };
  currency: string;
  section1: {
    salesEx: number;
    profit: number;
    marginPct: number;
    ordersCount: number;
    avgOrderValueExVat: number;
    activeCustomers: number;
    totalCustomers: number;
    activeRate: number;
    avgRevenuePerActiveCustomer: number;
  };
  section2: {
    newCustomersCreated: number;
    newCustomersFirstOrderCount: number;
    firstOrderAovExVat: number;
  };
  section3: {
    periodDays: number;
    elapsedDays: number;
    runRatePerDay: number;
    projectedSalesEx: number;
    projectedProfit: number;
  };
  section4: {
    revenueByRep: Array<{
      repId: string | null;
      repName: string;
      salesEx: number;
      profit: number;
      marginPct: number;
      ordersCount: number;
      activeCustomers: number;
    }>;
    totals: {
      assignedSalesEx: number;
      assignedProfit: number;
      unassignedSalesEx: number;
      unassignedProfit: number;
    };
    newCustomersByRep: Array<{
      repId: string | null;
      repName: string;
      newCustomersCreated: number;
      newCustomersFirstOrderCount: number;
      firstOrderAovExVat: number;
    }>;
  };
};

type Overview = {
  from: string;
  to: string;
  currency: string;

  // sales
  salesEx: number;
  profit: number;
  marginPct: number;
  ordersCount: number;
  avgOrderValueExVat: number;

  // customers / activity
  activeCustomers: number;
  totalCustomers: number;
  activeRate: number;
  avgRevenuePerActiveCustomer: number;

  // new customers
  newCustomersCreated: number;
  newCustomersFirstOrderCount: number;
  firstOrderAovExVat: number;

  // forecast
  periodDays: number;
  elapsedDays: number;
  runRatePerDay: number;
  projectedSalesEx: number;
  projectedProfit: number;

  // by rep
  revenueByRep: ApiOne["section4"]["revenueByRep"];
  assignedSalesEx: number;
  assignedProfit: number;
  unassignedSalesEx: number;
  unassignedProfit: number;

  newCustomersByRep: ApiOne["section4"]["newCustomersByRep"];
};

/* ---------- Date helpers ---------- */
const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
const ymdLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

function parseYMD(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}
function shiftYMD(s: string, { months = 0, years = 0 }: { months?: number; years?: number }) {
  const d = parseYMD(s);
  if (!d) return s;
  d.setFullYear(d.getFullYear() + years);
  d.setMonth(d.getMonth() + months);
  return ymdLocal(d);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/* ---------- Formatting ---------- */
const fmtMoney = (n: number | null | undefined, currency = "GBP") =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n);
const fmtPct = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toFixed(1)}%`;
const fmtInt = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n)}`;

const trendPct = (cur?: number | null, base?: number | null) => {
  if (cur == null || base == null) return null;
  if (base === 0) return cur === 0 ? 0 : 100;
  return ((cur - base) / Math.abs(base)) * 100;
};

function Delta({ cur, base }: { cur?: number | null; base?: number | null }) {
  const t = trendPct(cur, base);
  if (t == null) return <span className="small muted">—</span>;
  const up = t > 0;
  const down = t < 0;
  const sign = up ? "+" : down ? "−" : "";
  const color = up ? "#059669" : down ? "#dc2626" : "var(--muted)";
  return (
    <span className="small" style={{ color, fontWeight: 600 }}>
      {sign}
      {Math.abs(t).toFixed(1)}%
    </span>
  );
}

/* Convert API (single) to view model */
function toOverview(api: ApiOne): Overview {
  return {
    from: api?.range?.from || "",
    to: api?.range?.to || "",
    currency: api?.currency || "GBP",

    salesEx: api?.section1?.salesEx ?? 0,
    profit: api?.section1?.profit ?? 0,
    marginPct: api?.section1?.marginPct ?? 0,
    ordersCount: api?.section1?.ordersCount ?? 0,
    avgOrderValueExVat: api?.section1?.avgOrderValueExVat ?? 0,

    activeCustomers: api?.section1?.activeCustomers ?? 0,
    totalCustomers: api?.section1?.totalCustomers ?? 0,
    activeRate: api?.section1?.activeRate ?? 0,
    avgRevenuePerActiveCustomer: api?.section1?.avgRevenuePerActiveCustomer ?? 0,

    newCustomersCreated: api?.section2?.newCustomersCreated ?? 0,
    newCustomersFirstOrderCount: api?.section2?.newCustomersFirstOrderCount ?? 0,
    firstOrderAovExVat: api?.section2?.firstOrderAovExVat ?? 0,

    periodDays: api?.section3?.periodDays ?? 0,
    elapsedDays: api?.section3?.elapsedDays ?? 0,
    runRatePerDay: api?.section3?.runRatePerDay ?? 0,
    projectedSalesEx: api?.section3?.projectedSalesEx ?? 0,
    projectedProfit: api?.section3?.projectedProfit ?? 0,

    revenueByRep: api?.section4?.revenueByRep ?? [],
    assignedSalesEx: api?.section4?.totals?.assignedSalesEx ?? 0,
    assignedProfit: api?.section4?.totals?.assignedProfit ?? 0,
    unassignedSalesEx: api?.section4?.totals?.unassignedSalesEx ?? 0,
    unassignedProfit: api?.section4?.totals?.unassignedProfit ?? 0,

    newCustomersByRep: api?.section4?.newCustomersByRep ?? [],
  };
}

/* ---------- Metric row ---------- */
function MetricRow(props: {
  label: string;
  cur: number | null | undefined;
  compares?: Array<number | null | undefined>;
  kind?: "money" | "pct" | "int";
  currency?: string;
}) {
  const { label, cur, compares = [], kind, currency } = props;

  const renderVal = (v: number | null | undefined) => {
    switch (kind) {
      case "money": return fmtMoney(v as number, currency);
      case "pct":   return fmtPct(v as number);
      default:      return fmtInt(v as number);
    }
  };

  const rowStyle: React.CSSProperties = {
    alignItems: "center",
    padding: "16px 12px",
    borderBottom: "1px solid var(--border)",
    fontSize: 15,
  };
  const numStyle: React.CSSProperties = { width: 180, textAlign: "right", fontWeight: 600 };

  return (
    <div className="row" style={rowStyle}>
      <div style={{ flex: 2 }}>{label}</div>
      <div style={numStyle}>{renderVal(cur)}</div>
      {compares.map((v, i) => (
        <div key={`cmpv-${i}`} className="row" style={{ gap: 0, width: 270, justifyContent: "flex-end" }}>
          <div style={{ width: 180, textAlign: "right", fontWeight: 600 }}>{renderVal(v)}</div>
          <div style={{ width: 90, textAlign: "right" }}>
            <Delta cur={cur ?? null} base={v ?? null} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Small tables ---------- */
function TableHeader({ cols }: { cols: string[] }) {
  return (
    <div
      className="row"
      style={{
        padding: "8px 12px",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        background: "#fafafa",
        fontSize: 12,
        fontWeight: 600,
        color: "var(--muted)",
      }}
    >
      {cols.map((c, i) => (
        <div key={i} style={{ flex: i === 0 ? 2 : 1, textAlign: i === 0 ? "left" : "right" }}>{c}</div>
      ))}
    </div>
  );
}
function TableRow({ cells }: { cells: (string | number)[] }) {
  return (
    <div className="row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
      {cells.map((c, i) => (
        <div key={i} style={{ flex: i === 0 ? 2 : 1, textAlign: i === 0 ? "left" : "right", fontWeight: i === 0 ? 600 : 500 }}>
          {c}
        </div>
      ))}
    </div>
  );
}

/* =======================================================================
   Page
   ======================================================================= */
export default function CompanyOverviewPage() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState<string>(ymdLocal(firstOfMonth(today)));
  const [to, setTo] = useState<string>(ymdLocal(today));

  // Compare mode (date)
  type CmpMode = "date";
  const [showCompare, setShowCompare] = useState<boolean>(false);
  const [cmpMode] = useState<CmpMode>("date");

  // Date compare drafts
  const [cmpFromDraft, setCmpFromDraft] = useState<string>(ymdLocal(firstOfMonth(today)));
  const [cmpToDraft, setCmpToDraft] = useState<string>(ymdLocal(today));
  const [dateMode, setDateMode] = useState<"custom" | "previous-period" | "previous-year">("previous-period");

  // Applied comparisons
  const [comparisons, setComparisons] = useState<Array<{ label: string; data: Overview }>>([]);

  // Data
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<Overview | null>(null);

  /* Fetch current whenever primary selection changes */
  useEffect(() => {
    if (!from || !to) return;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const qs = new URLSearchParams({ from, to });
        const r = await fetch(`/api/reports/company-overview?${qs.toString()}`, {
          cache: "no-store",
          credentials: "include",
        });
        const j = (await r.json()) as ApiOne;
        if (!r.ok) throw new Error((j as any)?.error || "Failed to load overview");
        setCurrent(toOverview(j));
      } catch (e: any) {
        setErr(e?.message || "Failed to load overview");
        setCurrent(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [from, to]);

  async function fetchOne(f: string, t: string): Promise<Overview> {
    const qs = new URLSearchParams({ from: f, to: t });
    const r = await fetch(`/api/reports/company-overview?${qs.toString()}`, {
      cache: "no-store",
      credentials: "include",
    });
    const j = (await r.json()) as ApiOne;
    if (!r.ok || !j?.ok) throw new Error((j as any)?.error || "Fetch failed");
    return toOverview(j);
  }

  async function applyCompare() {
    if (!current) return;
    try {
      setLoading(true);
      setErr(null);

      const next: Array<{ label: string; data: Overview }> = [];

      if (dateMode === "custom") {
        const sc = await fetchOne(cmpFromDraft, cmpToDraft);
        next.push({ label: "Custom range", data: sc });
      } else if (dateMode === "previous-year") {
        const pf = shiftYMD(from, { years: -1 });
        const pt = shiftYMD(to, { years: -1 });
        const sc = await fetchOne(pf, pt);
        next.push({ label: "Previous year", data: sc });
      } else {
        // previous-period
        const dFrom = parseYMD(from);
        const dTo = parseYMD(to);
        if (dFrom && dTo) {
          const spanDays = Math.max(1, Math.round((dTo.getTime() - dFrom.getTime()) / 86400000) + 1);
          const prevTo = addDays(dFrom, -1);
          const prevFrom = addDays(prevTo, -(spanDays - 1));
          const pf = ymdLocal(prevFrom);
          const pt = ymdLocal(prevTo);
          const sc = await fetchOne(pf, pt);
          next.push({ label: "Previous period", data: sc });
        }
      }

      setComparisons(next);
    } catch (e: any) {
      setErr(e?.message || "Failed to apply comparison");
      setComparisons([]);
    } finally {
      setLoading(false);
    }
  }

  function clearCompare() {
    setComparisons([]);
  }

  // Column header
  function SectionHead(props: { title: string; subtitle?: string }) {
    return (
      <>
        <div style={{ padding: "14px 12px 6px 12px" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>{props.title}</h3>
            {props.subtitle ? <div className="small muted">{props.subtitle}</div> : null}
          </div>
        </div>
        <div
          className="row"
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
            background: "#fafafa",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--muted)",
          }}
        >
          <div style={{ flex: 2 }} />
          <div style={{ width: 180, textAlign: "right" }}>Selected</div>
          {comparisons.map((c, i) => (
            <div key={`head-${i}`} className="row" style={{ gap: 0, width: 270, justifyContent: "flex-end" }}>
              <div style={{ width: 180, textAlign: "right" }}>{c.label}</div>
              <div style={{ width: 90, textAlign: "right" }}>Δ %</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  const ccy = current?.currency || "GBP";

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Company Overview</h1>

        {/* Primary chooser */}
        <div className="grid" style={{ gap: 8, gridTemplateColumns: "auto auto" }}>
          <div className="field">
            <label>From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>

          <div className="field">
            <label>To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {/* Compare toggle & panel */}
        <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => setShowCompare((v) => !v)}>
            {showCompare ? "Hide compare" : "Compare…"}
          </button>

          {showCompare && (
            <div
              className="card"
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 12,
                border: "1px solid var(--border)",
                width: "100%",
              }}
            >
              <div className="grid" style={{ gap: 8, gridTemplateColumns: "1fr auto auto auto" }}>
                <div className="field">
                  <label>Mode</label>
                  <select
                    value={dateMode}
                    onChange={(e) => setDateMode(e.target.value as any)}
                  >
                    <option value="previous-period">Previous period</option>
                    <option value="previous-year">Previous year</option>
                    <option value="custom">Custom range</option>
                  </select>
                </div>

                <div className="field">
                  <label>From</label>
                  <input
                    type="date"
                    value={cmpFromDraft}
                    onChange={(e) => setCmpFromDraft(e.target.value)}
                    disabled={dateMode !== "custom"}
                  />
                </div>
                <div className="field">
                  <label>To</label>
                  <input
                    type="date"
                    value={cmpToDraft}
                    onChange={(e) => setCmpToDraft(e.target.value)}
                    disabled={dateMode !== "custom"}
                  />
                </div>

                <div className="field" style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
                  <button type="button" className="btn primary" onClick={applyCompare}>
                    Apply
                  </button>
                  {comparisons.length ? (
                    <button type="button" className="btn" onClick={clearCompare}>
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn"
            onClick={() => {
              if (!from || !to) return;
              setFrom((s) => s); // trigger effect
              if (comparisons.length) applyCompare();
            }}
          >
            Refresh
          </button>
        </div>

        <div className="small muted">
          Viewing <b>{from}</b> → <b>{to}</b>
          {comparisons.length ? (
            <> • comparing to <b>{comparisons.map((c) => c.label).join(", ")}</b></>
          ) : null}
        </div>

        {err && <div className="form-error">{err}</div>}
        {loading && <div className="small muted">Loading…</div>}
      </section>

      {/* ---------------- Sales / Orders ---------------- */}
      <section className="card" style={{ padding: 0 }}>
        <SectionHead title="Sales & Orders" subtitle="Company-wide sales (ex VAT), margin %, orders" />
        <div>
          <MetricRow
            label="Sales (ex VAT)"
            cur={current?.salesEx}
            compares={comparisons.map((c) => c.data.salesEx)}
            kind="money"
            currency={ccy}
          />
          <MetricRow
            label="Profit"
            cur={current?.profit}
            compares={comparisons.map((c) => c.data.profit)}
            kind="money"
            currency={ccy}
          />
          <MetricRow
            label="Margin %"
            cur={current?.marginPct}
            compares={comparisons.map((c) => c.data.marginPct)}
            kind="pct"
          />
          <MetricRow
            label="Total Orders"
            cur={current?.ordersCount}
            compares={comparisons.map((c) => c.data.ordersCount)}
            kind="int"
          />
          <MetricRow
            label="Average Order Value (ex VAT)"
            cur={current?.avgOrderValueExVat}
            compares={comparisons.map((c) => c.data.avgOrderValueExVat)}
            kind="money"
            currency={ccy}
          />
        </div>

        {/* Per-rep revenue/margin */}
        <div style={{ padding: "10px 12px" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <div className="small muted">
              Revenue & margin <b>by Rep</b> (current selection){current ? <> — assigned {fmtMoney(current.assignedSalesEx, ccy)} vs unassigned {fmtMoney(current.unassignedSalesEx, ccy)}</> : null}
            </div>
          </div>
        </div>
        <TableHeader cols={["Rep", "Sales (ex VAT)", "Profit", "Margin %", "Orders", "Active Cust."]} />
        <div>
          {current?.revenueByRep?.map((r) => (
            <TableRow
              key={`${r.repId ?? "none"}:${r.repName}`}
              cells={[
                r.repName || "Unassigned",
                fmtMoney(r.salesEx, ccy),
                fmtMoney(r.profit, ccy),
                fmtPct(r.marginPct),
                fmtInt(r.ordersCount),
                fmtInt(r.activeCustomers),
              ]}
            />
          ))}
          {!current?.revenueByRep?.length && (
            <div className="small muted" style={{ padding: "10px 12px" }}>No rep-attributed sales in this period.</div>
          )}
        </div>
      </section>

      {/* ---------------- Customers ---------------- */}
      <section className="card" style={{ padding: 0 }}>
        <SectionHead title="Customers" subtitle="Engagement & acquisition" />
        <div>
          <MetricRow
            label="Active Customers (unique buyers)"
            cur={current?.activeCustomers}
            compares={comparisons.map((c) => c.data.activeCustomers)}
            kind="int"
          />
          <MetricRow
            label="Total Customers (all time)"
            cur={current?.totalCustomers}
            compares={comparisons.map((c) => c.data.totalCustomers)}
            kind="int"
          />
          <MetricRow
            label="Active Rate"
            cur={current?.activeRate}
            compares={comparisons.map((c) => c.data.activeRate)}
            kind="pct"
          />
          <MetricRow
            label="Avg Revenue per Active Customer (ex VAT)"
            cur={current?.avgRevenuePerActiveCustomer}
            compares={comparisons.map((c) => c.data.avgRevenuePerActiveCustomer)}
            kind="money"
            currency={ccy}
          />
        </div>

        {/* New-customer attribution by rep */}
        <div style={{ padding: "10px 12px" }}>
          <div className="small muted">
            New customers <b>by Rep</b> (current selection)
          </div>
        </div>
        <TableHeader cols={["Rep", "Created", "First Orders", "First-Order AOV (ex VAT)"]} />
        <div>
          {current?.newCustomersByRep?.map((r) => (
            <TableRow
              key={`new-${r.repId ?? "none"}:${r.repName}`}
              cells={[
                r.repName || "Unassigned",
                fmtInt(r.newCustomersCreated),
                fmtInt(r.newCustomersFirstOrderCount),
                fmtMoney(r.firstOrderAovExVat, ccy),
              ]}
            />
          ))}
          {!current?.newCustomersByRep?.length && (
            <div className="small muted" style={{ padding: "10px 12px" }}>No new customers in this period.</div>
          )}
        </div>
      </section>

      {/* ---------------- Outlook / Forecast ---------------- */}
      <section className="card" style={{ padding: 0 }}>
        <SectionHead title="Outlook" subtitle="Simple run-rate projection to the end of the selected period" />
        <div>
          <MetricRow
            label="Run Rate (ex VAT) per Day"
            cur={current?.runRatePerDay}
            compares={comparisons.map((c) => c.data.runRatePerDay)}
            kind="money"
            currency={ccy}
          />
          <MetricRow
            label="Projected Sales (ex VAT) for Period"
            cur={current?.projectedSalesEx}
            compares={comparisons.map((c) => c.data.projectedSalesEx)}
            kind="money"
            currency={ccy}
          />
          <MetricRow
            label="Projected Profit for Period"
            cur={current?.projectedProfit}
            compares={comparisons.map((c) => c.data.projectedProfit)}
            kind="money"
            currency={ccy}
          />
        </div>
      </section>
    </div>
  );
}
