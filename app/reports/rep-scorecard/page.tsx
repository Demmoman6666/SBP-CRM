// app/reports/rep-scorecard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* Types */
type Rep = { id: string; name: string };

// Keep in sync with your API shape
type Scorecard = {
  // Section 1
  salesEx: number;        // Sales (ex VAT)
  marginPct: number;      // %
  profit: number;         // currency amount
  // Section 2
  totalCalls: number;
  coldCalls: number;
  bookedCalls: number;
  bookedDemos: number;
  avgTimePerCallMins: number;
  avgCallsPerDay: number;
  daysActive: number;
  // Section 3
  totalCustomers: number;
  newCustomers: number;
};

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function ymd(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

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

function fmtMoney(n?: number | null, currency = "£") {
  if (n == null || isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  return `${sign}${currency}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtPct(n?: number | null) {
  if (n == null || isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}
function diffPct(cur?: number | null, base?: number | null) {
  if (cur == null || base == null || isNaN(cur) || isNaN(base)) return null;
  if (base === 0) return cur === 0 ? 0 : 100; // arbitrary but useful
  return ((cur - base) / Math.abs(base)) * 100;
}
function Diff({ value }: { value: number | null }) {
  if (value == null || !isFinite(value)) return <span className="small muted">—</span>;
  const up = value >= 0;
  const color = up ? "#16a34a" /* green-600 */ : "#dc2626" /* red-600 */;
  const sign = up ? "+" : "";
  return (
    <span className="small" style={{ color }}>
      {sign}{value.toFixed(1)}%
    </span>
  );
}

/* Fetch helper */
async function fetchScorecard(rep: string, from: string, to: string): Promise<Scorecard | null> {
  if (!rep || !from || !to) return null;
  const qs = new URLSearchParams({ rep, from, to });
  const res = await fetch(`/api/reports/rep-scorecard?${qs.toString()}`, { cache: "no-store", credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as Scorecard;
}

export default function RepScorecardPage() {
  /* reps list */
  const [reps, setReps] = useState<Rep[]>([]);
  useEffect(() => {
    fetch("/api/sales-reps", { cache: "no-store", credentials: "include" })
      .then(r => r.json()).then(j => setReps(normalizeRepsResponse(j)))
      .catch(() => setReps([]));
  }, []);

  /* primary selection */
  const today = useMemo(() => new Date(), []);
  const [repId, setRepId] = useState<string>("");
  const [from, setFrom] = useState<string>(ymd(today));
  const [to, setTo] = useState<string>(ymd(today));
  const [cur, setCur] = useState<Scorecard | null>(null);

  /* comparison selection (rep + timeframe) */
  const [cmpRepId, setCmpRepId] = useState<string>("");
  // default compare period = previous day(s) same span
  const [cmpFrom, setCmpFrom] = useState<string>(ymd(addDays(today, -7)));
  const [cmpTo, setCmpTo] = useState<string>(ymd(today));
  const [cmp, setCmp] = useState<Scorecard | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // default rep once loaded
  useEffect(() => {
    if (reps.length && !repId) setRepId(reps[0].id);
    if (reps.length && !cmpRepId) setCmpRepId(reps[0].id);
  }, [reps, repId, cmpRepId]);

  async function load() {
    if (!repId) return;
    setLoading(true);
    setErr(null);
    try {
      const [a, b] = await Promise.all([
        fetchScorecard(repId, from, to),
        cmpRepId && cmpFrom && cmpTo ? fetchScorecard(cmpRepId, cmpFrom, cmpTo) : Promise.resolve(null),
      ]);
      setCur(a);
      setCmp(b);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* initial */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repId]);

  const repName = reps.find(r => r.id === repId)?.name || repId || "—";
  const cmpRepName = reps.find(r => r.id === cmpRepId)?.name || cmpRepId || "—";

  function Head({ title, sub }: { title: string; sub?: string }) {
    return (
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {sub ? <div className="small muted">{sub}</div> : null}
      </div>
    );
  }

  function MetricRow(props: {
    label: string;
    fmt?: "money" | "pct" | "int";
    cur?: number | null;
    base?: number | null;
  }) {
    const { label, fmt = "int", cur = null, base = null } = props;
    const val =
      fmt === "money" ? fmtMoney(cur) :
      fmt === "pct" ? fmtPct(cur) :
      cur == null || isNaN(cur) ? "—" : cur.toLocaleString();
    const d = diffPct(cur ?? null, base ?? null);
    return (
      <div className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ flex: 2 }}>{label}</div>
        <div style={{ width: 160, textAlign: "right", fontWeight: 600 }}>{val}</div>
        <div style={{ width: 90, textAlign: "right" }}>
          {cmp ? <Diff value={d} /> : <span className="small muted">—</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card grid" style={{ gap: 12 }}>
        <h1 style={{ marginBottom: 4 }}>Rep Scorecard</h1>

        {/* Controls */}
        <div className="grid" style={{ gap: 12 }}>
          {/* Primary rep + dates */}
          <div className="card" style={{ padding: 12 }}>
            <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <label className="small muted">Rep</label>
                <select value={repId} onChange={(e) => setRepId(e.target.value)}>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <label className="small muted">From</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <label className="small muted">To</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Compare rep + dates */}
          <div className="card" style={{ padding: 12 }}>
            <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <label className="small muted">Compare to</label>
                <select value={cmpRepId} onChange={(e) => setCmpRepId(e.target.value)}>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <label className="small muted">From</label>
                <input type="date" value={cmpFrom} onChange={(e) => setCmpFrom(e.target.value)} />
              </div>
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <label className="small muted">To</label>
                <input type="date" value={cmpTo} onChange={(e) => setCmpTo(e.target.value)} />
              </div>
              <button className="btn" onClick={load} disabled={loading}>
                {loading ? "Loading…" : "Apply"}
              </button>
            </div>
          </div>
        </div>

        <div className="small muted">
          Viewing <b>{repName}</b> {from} → {to}
          {cmp ? <> • comparing to <b>{cmpRepName}</b> {cmpFrom} → {cmpTo}</> : null}
        </div>

        {err && <div className="form-error">{err}</div>}
      </section>

      {/* Metrics */}
      <section className="card" style={{ padding: 0 }}>
        <div style={{ padding: "12px 12px 0" }}>
          <Head title="Section 1" sub="Sales (ex VAT), margin %, profit" />
        </div>
        <div style={{ padding: "0 12px 12px" }}>
          <MetricRow label="Sales (ex VAT)" fmt="money" cur={cur?.salesEx} base={cmp?.salesEx} />
          <MetricRow label="Margin %" fmt="pct" cur={cur?.marginPct} base={cmp?.marginPct} />
          <MetricRow label="Profit" fmt="money" cur={cur?.profit} base={cmp?.profit} />
        </div>

        <div style={{ padding: "12px 12px 0" }}>
          <Head title="Section 2" sub="Call volumes & activity" />
        </div>
        <div style={{ padding: "0 12px 12px" }}>
          <MetricRow label="Total Calls" cur={cur?.totalCalls} base={cmp?.totalCalls} />
          <MetricRow label="Cold Calls" cur={cur?.coldCalls} base={cmp?.coldCalls} />
          <MetricRow label="Booked Calls" cur={cur?.bookedCalls} base={cmp?.bookedCalls} />
          <MetricRow label="Booked Demos" cur={cur?.bookedDemos} base={cmp?.bookedDemos} />
          <MetricRow label="Average Time Per Call (mins)" cur={cur?.avgTimePerCallMins} base={cmp?.avgTimePerCallMins} />
          <MetricRow label="Average Calls per Day" cur={cur?.avgCallsPerDay} base={cmp?.avgCallsPerDay} />
          <MetricRow label="Days Active" cur={cur?.daysActive} base={cmp?.daysActive} />
        </div>

        <div style={{ padding: "12px 12px 0" }}>
          <Head title="Section 3" sub="Customer counts" />
        </div>
        <div style={{ padding: "0 12px 12px" }}>
          <MetricRow label="Total Customers" cur={cur?.totalCustomers} base={cmp?.totalCustomers} />
          <MetricRow label="New Customers" cur={cur?.newCustomers} base={cmp?.newCustomers} />
        </div>
      </section>
    </div>
  );
}
