// app/reports/rep-scorecard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* ---------- Types ---------- */
type Rep = { id: string; name: string };

// Shape expected back from /api/reports/rep-scorecard
type Scorecard = {
  rep: string;
  from: string; // yyyy-mm-dd
  to: string;   // yyyy-mm-dd

  // Section: Sales
  salesEx: number;        // ex VAT
  marginPct: number;      // %
  profit: number;         // money

  // Section: Calls
  totalCalls: number;
  coldCalls: number;
  bookedCalls: number;
  bookedDemos: number;
  avgTimePerCallMins: number;
  avgCallsPerDay: number;
  daysActive: number;

  // Section: Customers
  totalCustomers: number;
  newCustomers: number;
};

type ApiResponse = {
  current: Scorecard;
  compare?: Scorecard | null;
};

/* ---------- Date helpers ---------- */
const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
const ymdLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/* ---------- Formatting ---------- */
const fmtMoney = (n: number | null | undefined, currency = "GBP") =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n);

const fmtPct = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toFixed(1)}%`;

const fmtInt = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n)}`;

const trendPct = (cur?: number | null, base?: number | null) => {
  if (cur == null || base == null) return null;
  if (base === 0) {
    if (cur === 0) return 0;
    return 100; // treat as +100% if rising from 0
  }
  return ((cur - base) / Math.abs(base)) * 100;
};

function Delta({ cur, base }: { cur?: number | null; base?: number | null }) {
  const t = trendPct(cur, base);
  if (t == null) return <span className="small muted">—</span>;
  const sign = t > 0 ? "+" : t < 0 ? "−" : "";
  const color = t > 0 ? "#059669" : t < 0 ? "#dc2626" : "var(--muted)";
  return (
    <span className="small" style={{ color }}>
      {sign}
      {Math.abs(t).toFixed(1)}%
    </span>
  );
}

function MetricRow(props: {
  label: string;
  cur: number | null | undefined;
  base?: number | null;
  kind?: "money" | "pct" | "int" | "mins";
}) {
  const value =
    props.kind === "money"
      ? fmtMoney(props.cur as number)
      : props.kind === "pct"
      ? fmtPct(props.cur as number)
      : props.kind === "mins"
      ? (props.cur == null ? "—" : `${(props.cur as number).toFixed(1)}`)
      : fmtInt(props.cur as number);

  return (
    <div className="row" style={{ alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ flex: 2 }}>{props.label}</div>
      <div style={{ width: 140, textAlign: "right" }}>{value}</div>
      <div style={{ width: 80, textAlign: "right" }}>
        {"base" in props ? <Delta cur={props.cur as number} base={props.base} /> : <span className="small muted">—</span>}
      </div>
    </div>
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

  // Compare (applied separately)
  const [showCompare, setShowCompare] = useState<boolean>(false);
  const [cmpRepDraft, setCmpRepDraft] = useState<string>("");
  const [cmpFromDraft, setCmpFromDraft] = useState<string>(ymdLocal(firstOfMonth(today)));
  const [cmpToDraft, setCmpToDraft] = useState<string>(ymdLocal(today));

  const [cmpRep, setCmpRep] = useState<string | null>(null);
  const [cmpFrom, setCmpFrom] = useState<string | null>(null);
  const [cmpTo, setCmpTo] = useState<string | null>(null);

  // Data
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resp, setResp] = useState<ApiResponse | null>(null);

  /* Load reps list */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sales-reps", { cache: "no-store", credentials: "include" });
        const j = await r.json().catch(() => null);
        const list = normalizeRepsResponse(j);
        setReps(list);
        if (!rep && list.length) {
          setRep(list[0].name); // default to first rep
          // default compare draft to same (user can change)
          setCmpRepDraft(list[0].name);
        }
      } catch {
        setReps([]);
      }
    })();
  }, []); // eslint-disable-line

  /* Fetch scorecard whenever primary selection changes OR applied compare changes */
  useEffect(() => {
    if (!rep || !from || !to) return;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const qs = new URLSearchParams({ rep, from, to });
        if (cmpRep && cmpFrom && cmpTo) {
          qs.set("cmpRep", cmpRep);
          qs.set("cmpFrom", cmpFrom);
          qs.set("cmpTo", cmpTo);
        }
        const r = await fetch(`/api/reports/rep-scorecard?${qs.toString()}`, {
          cache: "no-store",
          credentials: "include",
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Failed to load scorecard");
        setResp(j as ApiResponse);
      } catch (e: any) {
        setErr(e?.message || "Failed to load scorecard");
        setResp(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [rep, from, to, cmpRep, cmpFrom, cmpTo]); // eslint-disable-line

  // Apply compare (from drafts only when the user clicks Apply)
  function applyCompare() {
    if (!cmpRepDraft || !cmpFromDraft || !cmpToDraft) return;
    setCmpRep(cmpRepDraft);
    setCmpFrom(cmpFromDraft);
    setCmpTo(cmpToDraft);
  }
  function clearCompare() {
    setCmpRep(null);
    setCmpFrom(null);
    setCmpTo(null);
  }

  // Guarded accessors
  const cur = resp?.current;
  const base = resp?.compare || null;

  const viewingLine = (
    <div className="small muted">
      Viewing <b>{rep || "—"}</b> {from ? <span> {from} </span> : null}
      {to ? <>→ {to}</> : null}
      {cmpRep && cmpFrom && cmpTo ? (
        <>
          {" "}• comparing to <b>{cmpRep}</b> {cmpFrom} → {cmpTo}
        </>
      ) : null}
    </div>
  );

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Rep Scorecard</h1>

        {/* Primary chooser (auto-applied) */}
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
              <div className="grid" style={{ gap: 8, gridTemplateColumns: "1fr auto auto auto" }}>
                <div className="field">
                  <label>Compare to</label>
                  <select
                    value={cmpRepDraft}
                    onChange={(e) => setCmpRepDraft(e.target.value)}
                  >
                    {reps.map((r) => (
                      <option key={r.id || r.name} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
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
                  {cmpRep && cmpFrom && cmpTo && (
                    <button type="button" className="btn" onClick={clearCompare}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {viewingLine}

        {err && <div className="form-error">{err}</div>}
        {loading && <div className="small muted">Loading…</div>}
      </section>

      {/* Metrics */}
      <section className="card" style={{ padding: 0 }}>
        {/* Sales */}
        <div style={{ padding: "12px 12px 0 12px" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>Sales</h3>
            <div className="small muted">Sales (ex VAT), margin %, profit</div>
          </div>
        </div>
        <div style={{ padding: "0 12px 12px 12px" }}>
          <MetricRow label="Sales (ex VAT)" cur={cur?.salesEx} base={base?.salesEx} kind="money" />
          <MetricRow label="Margin %" cur={cur?.marginPct} base={base?.marginPct} kind="pct" />
          <MetricRow label="Profit" cur={cur?.profit} base={base?.profit} kind="money" />
        </div>

        {/* Calls */}
        <div style={{ padding: "12px 12px 0 12px", borderTop: "1px solid var(--border)" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>Calls</h3>
            <div className="small muted">Call volumes &amp; activity</div>
          </div>
        </div>
        <div style={{ padding: "0 12px 12px 12px" }}>
          <MetricRow label="Total Calls" cur={cur?.totalCalls} base={base?.totalCalls} kind="int" />
          <MetricRow label="Cold Calls" cur={cur?.coldCalls} base={base?.coldCalls} kind="int" />
          <MetricRow label="Booked Calls" cur={cur?.bookedCalls} base={base?.bookedCalls} kind="int" />
          <MetricRow label="Booked Demos" cur={cur?.bookedDemos} base={base?.bookedDemos} kind="int" />
          <MetricRow label="Average Time Per Call (mins)" cur={cur?.avgTimePerCallMins} base={base?.avgTimePerCallMins} kind="mins" />
          <MetricRow label="Average Calls per Day" cur={cur?.avgCallsPerDay} base={base?.avgCallsPerDay} kind="mins" />
          <MetricRow label="Days Active" cur={cur?.daysActive} base={base?.daysActive} kind="int" />
        </div>

        {/* Customers */}
        <div style={{ padding: "12px 12px 0 12px", borderTop: "1px solid var(--border)" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>Customers</h3>
            <div className="small muted">Customer counts</div>
          </div>
        </div>
        <div style={{ padding: "0 12px 12px 12px" }}>
          <MetricRow label="Total Customers" cur={cur?.totalCustomers} base={base?.totalCustomers} kind="int" />
          <MetricRow label="New Customers" cur={cur?.newCustomers} base={base?.newCustomers} kind="int" />
        </div>
      </section>
    </div>
  );
}
