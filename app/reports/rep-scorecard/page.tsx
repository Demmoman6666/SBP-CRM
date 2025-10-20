// app/reports/rep-scorecard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* ---------- Types ---------- */
type Rep = { id: string; name: string };

// Shape returned by /api/reports/rep-scorecard (single payload)
type ApiOne = {
  ok: boolean;
  range: { from: string; to: string };
  rep: { id: string | null; name: string | null };
  currency: string;
  section1: {
    salesEx: number;
    profit: number;
    marginPct: number;
    avgOrderValueExVat?: number;   // <-- NEW
    ordersCount?: number;          // (not displayed, handy for later)
  };
  section2: {
    totalCalls: number;
    coldCalls: number;
    bookedCalls: number;
    bookedDemos: number;
    avgTimePerCallMins: number;
    avgCallsPerDay: number;
    activeDays: number; // API calls it activeDays
  };
  section3: { totalCustomers: number; newCustomers: number };
};

type Scorecard = {
  rep: string;
  from: string;
  to: string;
  currency: string;
  // sales
  salesEx: number;
  marginPct: number;
  profit: number;
  avgOrderValueExVat: number;      // <-- NEW
  // calls
  totalCalls: number;
  coldCalls: number;
  bookedCalls: number;
  bookedDemos: number;
  avgTimePerCallMins: number;
  avgCallsPerDay: number;
  daysActive: number; // local naming
  // customers
  totalCustomers: number;
  newCustomers: number;
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

const fmtMins = (n: number | null | undefined) =>
  n == null ? "—" : `${(n as number).toFixed(1)}`;

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

/* Normalize /api/sales-reps (array of strings or array of objects, or {ok,reps}) */
function normalizeRepsResponse(j: any): Rep[] {
  if (Array.isArray(j)) {
    return j
      .map((r: any) =>
        typeof r === "string"
          ? { id: r, name: r }
          : { id: String(r?.id ?? r?.name ?? ""), name: String(r?.name ?? r?.id ?? "") }
      )
      .filter((r) => !!r.name);
  }
  if (j?.ok && Array.isArray(j.reps)) {
    return j.reps
      .map((name: any) => String(name || ""))
      .filter(Boolean)
      .map((name: string) => ({ id: name, name }));
  }
  return [];
}

/* Convert API (single) to Scorecard shape */
function toScore(api: ApiOne): Scorecard {
  return {
    rep: api?.rep?.name || "",
    from: api?.range?.from || "",
    to: api?.range?.to || "",
    currency: api?.currency || "GBP",
    salesEx: api?.section1?.salesEx ?? 0,
    marginPct: api?.section1?.marginPct ?? 0,
    profit: api?.section1?.profit ?? 0,
    avgOrderValueExVat: api?.section1?.avgOrderValueExVat ?? 0, // <-- NEW
    totalCalls: api?.section2?.totalCalls ?? 0,
    coldCalls: api?.section2?.coldCalls ?? 0,
    bookedCalls: api?.section2?.bookedCalls ?? 0,
    bookedDemos: api?.section2?.bookedDemos ?? 0,
    avgTimePerCallMins: api?.section2?.avgTimePerCallMins ?? 0,
    avgCallsPerDay: api?.section2?.avgCallsPerDay ?? 0,
    daysActive: api?.section2?.activeDays ?? 0,
    totalCustomers: api?.section3?.totalCustomers ?? 0,
    newCustomers: api?.section3?.newCustomers ?? 0,
  };
}

/* ---------- Metric row (supports many compare columns) ---------- */
function MetricRow(props: {
  label: string;
  cur: number | null | undefined;
  compares?: Array<number | null | undefined>;
  kind?: "money" | "pct" | "int" | "mins";
  currency?: string;
}) {
  const { label, cur, compares = [], kind, currency } = props;

  const renderVal = (v: number | null | undefined) => {
    switch (kind) {
      case "money": return fmtMoney(v as number, currency);
      case "pct":   return fmtPct(v as number);
      case "mins":  return fmtMins(v as number);
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

/* =======================================================================
   Page
   ======================================================================= */
export default function RepScorecardPage() {
  const today = useMemo(() => new Date(), []);
  const [reps, setReps] = useState<Rep[]>([]);

  // Primary (auto-applied) selection
  const [rep, setRep] = useState<string>("");
  const [from, setFrom] = useState<string>(ymdLocal(firstOfMonth(today)));
  const [to, setTo] = useState<string>(ymdLocal(today));

  // Compare mode
  type CmpMode = "reps" | "date";
  const [showCompare, setShowCompare] = useState<boolean>(false);
  const [cmpMode, setCmpMode] = useState<CmpMode>("reps");

  // Drafts (not applied until user clicks Apply)
  const [cmpRepsDraft, setCmpRepsDraft] = useState<string[]>([]);
  const [cmpRepsOpen, setCmpRepsOpen] = useState<boolean>(false); // dropdown open/close

  const [cmpFromDraft, setCmpFromDraft] = useState<string>(ymdLocal(firstOfMonth(today)));
  const [cmpToDraft, setCmpToDraft] = useState<string>(ymdLocal(today));
  const [dateMode, setDateMode] = useState<"custom" | "previous-period" | "previous-year">("custom");

  // Applied comparisons
  const [comparisons, setComparisons] = useState<Array<{ label: string; data: Scorecard }>>([]);

  // Data
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<Scorecard | null>(null);

  /* Load reps list */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sales-reps", { cache: "no-store", credentials: "include" });
        const j = await r.json().catch(() => null);
        const list = normalizeRepsResponse(j);
        setReps(list);
        if (!rep && list.length) setRep(list[0].name);
        if (cmpRepsDraft.length === 0 && list.length) setCmpRepsDraft([list[0].name]);
      } catch {
        setReps([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Fetch current whenever primary selection changes */
  useEffect(() => {
    if (!rep || !from || !to) return;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        // IMPORTANT: send both rep and staff (same value) to satisfy API filters in all envs
        const qs = new URLSearchParams({ rep, staff: rep, from, to });
        const r = await fetch(`/api/reports/rep-scorecard?${qs.toString()}`, {
          cache: "no-store",
          credentials: "include",
        });
        const j = (await r.json()) as ApiOne;
        if (!r.ok) throw new Error((j as any)?.error || "Failed to load scorecard");
        setCurrent(toScore(j));
      } catch (e: any) {
        setErr(e?.message || "Failed to load scorecard");
        setCurrent(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [rep, from, to]);

  async function fetchOne(repName: string, f: string, t: string): Promise<Scorecard> {
    // IMPORTANT: also pass staff for robustness
    const qs = new URLSearchParams({ rep: repName, staff: repName, from: f, to: t });
    const r = await fetch(`/api/reports/rep-scorecard?${qs.toString()}`, {
      cache: "no-store",
      credentials: "include",
    });
    const j = (await r.json()) as ApiOne;
    if (!r.ok || !j?.ok) throw new Error((j as any)?.error || "Fetch failed");
    return toScore(j);
  }

  async function applyCompare() {
    if (!current) return;

    try {
      setLoading(true);
      setErr(null);

      const next: Array<{ label: string; data: Scorecard }> = []; // <-- fixed extra '>'

      if (cmpMode === "reps") {
        for (const name of cmpRepsDraft) {
          const sc = await fetchOne(name, cmpFromDraft, cmpToDraft);
          next.push({ label: name, data: sc });
        }
        setCmpRepsOpen(false);
      } else {
        // date range compares (against SAME rep)
        if (dateMode === "custom") {
          const sc = await fetchOne(rep, cmpFromDraft, cmpToDraft);
          next.push({ label: "Custom range", data: sc });
        } else if (dateMode === "previous-year") {
          const pf = shiftYMD(from, { years: -1 });
          const pt = shiftYMD(to, { years: -1 });
          const sc = await fetchOne(rep, pf, pt);
          next.push({ label: "Previous year", data: sc });
        } else {
          // previous-period: same span immediately before [from, to]
          const dFrom = parseYMD(from);
          const dTo = parseYMD(to);
          if (dFrom && dTo) {
            const spanDays = Math.max(1, Math.round((dTo.getTime() - dFrom.getTime()) / 86400000) + 1);
            const prevTo = addDays(dFrom, -1);
            const prevFrom = addDays(prevTo, -(spanDays - 1));
            const pf = ymdLocal(prevFrom);
            const pt = ymdLocal(prevTo);
            const sc = await fetchOne(rep, pf, pt);
            next.push({ label: "Previous period", data: sc });
          }
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

  const viewingLine = (
    <div className="small muted">
      Viewing <b>{rep || "—"}</b> {from ? <span> {from} </span> : null}
      {to ? <>→ {to}</> : null}
      {comparisons.length ? (
        <>
          {" "}• comparing to <b>{comparisons.map((c) => c.label).join(", ")}</b>
        </>
      ) : null}
    </div>
  );

  // Column headers above value/compare/delta
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
          <div style={{ width: 180, textAlign: "right" }}>{current?.rep || rep || "Selected rep"}</div>
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
  const repsBtnLabel = cmpRepsDraft.length ? cmpRepsDraft.join(", ") : "Choose reps…";

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Rep Scorecard</h1>

        {/* Primary chooser */}
        <div className="grid" style={{ gap: 8, gridTemplateColumns: "1fr auto auto" }}>
          <div className="field">
            <label>Rep</label>
            <select value={rep} onChange={(e) => setRep(e.target.value)}>
              {reps.map((r) => (
                <option key={r.id || r.name} value={r.name}>
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
        </div>

        {/* Compare toggle & panel (NOT auto-applied) */}
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
              {/* Mode selector */}
              <div className="row" style={{ gap: 12, alignItems: "center", marginBottom: 8 }}>
                <label className="small muted">Compare mode</label>
                <select value={cmpMode} onChange={(e) => setCmpMode(e.target.value as CmpMode)}>
                  <option value="reps">Reps</option>
                  <option value="date">Date range</option>
                </select>
              </div>

              {cmpMode === "reps" ? (
                // Dropdown-style multi-select for reps + date range
                <div className="grid" style={{ gap: 8, gridTemplateColumns: "1fr auto auto auto" }}>
                  <div className="field">
                    <label>Compare to (multi-select)</label>
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setCmpRepsOpen((v) => !v)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          background: "#fff",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {repsBtnLabel}
                      </button>

                      {cmpRepsOpen && (
                        <div
                          style={{
                            position: "absolute",
                            top: "calc(100% + 6px)",
                            left: 0,
                            right: 0,
                            maxHeight: 260,
                            overflow: "auto",
                            background: "#fff",
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            boxShadow: "var(--shadow)",
                            padding: 8,
                            zIndex: 50,
                          }}
                        >
                          {reps.map((r) => {
                            const checked = cmpRepsDraft.includes(r.name);
                            return (
                              <label
                                key={r.id || r.name}
                                className="row"
                                style={{ gap: 8, alignItems: "center", padding: "6px 4px" }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setCmpRepsDraft((prev) =>
                                        prev.includes(r.name) ? prev : [...prev, r.name]
                                      );
                                    } else {
                                      setCmpRepsDraft((prev) => prev.filter((x) => x !== r.name));
                                    }
                                  }}
                                />
                                {r.name}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="field">
                    <label>From</label>
                    <input
                      type="date"
                      value={cmpFromDraft}
                      onChange={(e) => setCmpFromDraft(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>To</label>
                    <input
                      type="date"
                      value={cmpToDraft}
                      onChange={(e) => setCmpToDraft(e.target.value)}
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
              ) : (
                // Date range compare: custom / previous period / previous year
                <div className="grid" style={{ gap: 8, gridTemplateColumns: "1fr auto auto auto" }}>
                  <div className="field">
                    <label>Mode</label>
                    <select
                      value={dateMode}
                      onChange={(e) => setDateMode(e.target.value as any)}
                    >
                      <option value="custom">Custom range</option>
                      <option value="previous-period">Previous period</option>
                      <option value="previous-year">Previous year</option>
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
              )}
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn"
            onClick={() => {
              if (!rep || !from || !to) return;
              // re-run primary fetch (effect already watches rep/from/to)
              setFrom((s) => s);
              if (comparisons.length) applyCompare();
            }}
          >
            Refresh
          </button>
        </div>

        <div className="small muted">
          Viewing <b>{rep || "—"}</b> {from ? <span> {from} </span> : null}
          {to ? <>→ {to}</> : null}
          {comparisons.length ? (
            <>
              {" "}• comparing to <b>{comparisons.map((c) => c.label).join(", ")}</b>
            </>
          ) : null}
        </div>

        {err && <div className="form-error">{err}</div>}
        {loading && <div className="small muted">Loading…</div>}
      </section>

      {/* ---------------- Sales ---------------- */}
      <section className="card" style={{ padding: 0 }}>
        <SectionHead title="Sales" subtitle="Sales (ex VAT), margin %, profit" />
        <div>
          <MetricRow
            label="Sales (ex VAT)"
            cur={current?.salesEx}
            compares={comparisons.map((c) => c.data.salesEx)}
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
            label="Profit"
            cur={current?.profit}
            compares={comparisons.map((c) => c.data.profit)}
            kind="money"
            currency={ccy}
          />
          {/* NEW: Average Order Value (ex VAT) */}
          <MetricRow
            label="Average Order Value (ex VAT)"
            cur={current?.avgOrderValueExVat}
            compares={comparisons.map((c) => c.data.avgOrderValueExVat)}
            kind="money"
            currency={ccy}
          />
        </div>

      {/* ---------------- Calls ---------------- */}
        <SectionHead title="Calls" subtitle="Call volumes & activity" />
        <div>
          <MetricRow label="Total Calls" cur={current?.totalCalls} compares={comparisons.map((c) => c.data.totalCalls)} kind="int" />
          <MetricRow label="Cold Calls" cur={current?.coldCalls} compares={comparisons.map((c) => c.data.coldCalls)} kind="int" />
          <MetricRow label="Booked Calls" cur={current?.bookedCalls} compares={comparisons.map((c) => c.data.bookedCalls)} kind="int" />
          <MetricRow label="Booked Demos" cur={current?.bookedDemos} compares={comparisons.map((c) => c.data.bookedDemos)} kind="int" />
          <MetricRow label="Average Time Per Call (mins)" cur={current?.avgTimePerCallMins} compares={comparisons.map((c) => c.data.avgTimePerCallMins)} kind="mins" />
          <MetricRow label="Average Calls per Day" cur={current?.avgCallsPerDay} compares={comparisons.map((c) => c.data.avgCallsPerDay)} kind="mins" />
          <MetricRow label="Days Active" cur={current?.daysActive} compares={comparisons.map((c) => c.data.daysActive)} kind="int" />
        </div>

        {/* ---------------- Customers ---------------- */}
        <SectionHead title="Customers" subtitle="Customer counts" />
        <div>
          <MetricRow label="Total Customers" cur={current?.totalCustomers} compares={comparisons.map((c) => c.data.totalCustomers)} kind="int" />
          <MetricRow label="New Customers" cur={current?.newCustomers} compares={comparisons.map((c) => c.data.newCustomers)} kind="int" />
        </div>
      </section>
    </div>
  );
}
