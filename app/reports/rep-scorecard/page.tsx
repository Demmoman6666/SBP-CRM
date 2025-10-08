// app/reports/rep-scorecard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* ---------- Types ---------- */
type Rep = { id: string; name: string };

type Scorecard = {
  rep: string;
  // Section 1
  salesEx: number;       // Sales (ex VAT)
  marginPct: number;     // %
  profit: number;        // currency
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

/* ---------- Date helpers ---------- */
function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function ymdLocal(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDaysLocal(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function mondayOfWeek(d: Date) { const dow = d.getDay(); const delta = dow === 0 ? -6 : 1 - dow; return addDaysLocal(d, delta); }
function firstOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastMonthFirst(d: Date) { return new Date(d.getFullYear(), d.getMonth() - 1, 1); }
function lastMonthLast(d: Date) { const firstThis = new Date(d.getFullYear(), d.getMonth(), 1); return addDaysLocal(firstThis, -1); }
function ytdFirst(d: Date) { return new Date(d.getFullYear(), 0, 1); }
function parseYMD(s: string) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return null; return new Date(+m[1], +m[2]-1, +m[3]); }
function diffDaysInclusive(a: string, b: string) {
  const A = parseYMD(a)!, B = parseYMD(b)!;
  const ms = Math.abs(+B - +A);
  return Math.floor(ms / 86400000) + 1;
}

/* ---------- Small UI helpers ---------- */
const fmt = (n: number | null | undefined, dp = 0) =>
  n == null || isNaN(n as number) ? "—" : Number(n).toFixed(dp);

function normalizeReps(payload: any): Rep[] {
  const arr = Array.isArray(payload) ? payload : Array.isArray(payload?.reps) ? payload.reps : [];
  return arr
    .map((r: any): Rep =>
      typeof r === "string"
        ? { id: r, name: r }
        : { id: String(r?.id ?? r?.name ?? ""), name: String(r?.name ?? r?.id ?? "") }
    )
    .filter((r: Rep) => !!r.name);
}

function PctDelta({ base, value }: { base: number; value: number }) {
  if (!isFinite(base) || base === 0) return null;
  const pct = ((value - base) / Math.abs(base)) * 100;
  const color = pct > 0 ? "#16a34a" : pct < 0 ? "#b91c1c" : "var(--muted)";
  const sign = pct > 0 ? "+" : "";
  return (
    <span className="small" style={{ marginLeft: 6, color }}>
      {sign}{pct.toFixed(1)}%
    </span>
  );
}

/* ---------- Page ---------- */
export default function RepScorecardPage() {
  const today = useMemo(() => new Date(), []);

  // PRIMARY selection
  const [from, setFrom] = useState<string>(ymdLocal(today));
  const [to, setTo] = useState<string>(ymdLocal(today));
  const [primaryRep, setPrimaryRep] = useState<string>("");

  // COMPARISON selection (rep + separate date range)
  const [cmpFrom, setCmpFrom] = useState<string>(ymdLocal(today));
  const [cmpTo, setCmpTo] = useState<string>(ymdLocal(today));
  const [compareRep, setCompareRep] = useState<string>("");

  // Data
  const [allReps, setAllReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [primary, setPrimary] = useState<Scorecard | null>(null);
  const [comparison, setComparison] = useState<Scorecard | null>(null);

  // Load reps list
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sales-reps", { cache: "no-store", credentials: "include" });
        const j = await r.json().catch(() => null);
        const reps = normalizeReps(j);
        setAllReps(reps);

        // sensible defaults
        if (!primaryRep && reps[0]) setPrimaryRep(reps[0].name);
        if (!compareRep && reps[1]) setCompareRep(reps[1].name);
      } catch {
        setAllReps([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchCard(rep: string, f: string, t: string): Promise<Scorecard | null> {
    if (!rep || !f || !t) return null;
    const qs = new URLSearchParams({ from: f, to: t, rep });
    const res = await fetch(`/api/reports/rep-scorecard?${qs.toString()}`, {
      cache: "no-store",
      credentials: "include",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error || "Failed to load");
    return json as Scorecard;
  }

  async function load() {
    if (!primaryRep) return;
    setLoading(true);
    setErr(null);
    try {
      const [a, b] = await Promise.all([
        fetchCard(primaryRep, from, to),
        fetchCard(compareRep || primaryRep, cmpFrom || from, cmpTo || to),
      ]);
      setPrimary(a);
      setComparison(b);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
      setPrimary(null);
      setComparison(null);
    } finally {
      setLoading(false);
    }
  }

  // initial load once we have reps
  useEffect(() => {
    if (primaryRep) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryRep, compareRep]);

  /* Range presets (primary & compare) */
  function pickRange(kind: string, which: "main" | "cmp") {
    const now = new Date();
    let f = which === "main" ? from : cmpFrom;
    let t = which === "main" ? to : cmpTo;

    if (kind === "today") { f = ymdLocal(now); t = ymdLocal(now); }
    else if (kind === "yesterday") { const y = addDaysLocal(now, -1); f = ymdLocal(y); t = ymdLocal(y); }
    else if (kind === "wtd") { const start = mondayOfWeek(now); f = ymdLocal(start); t = ymdLocal(now); }
    else if (kind === "lweek") { const thisMon = mondayOfWeek(now); f = ymdLocal(addDaysLocal(thisMon, -7)); t = ymdLocal(addDaysLocal(thisMon, -1)); }
    else if (kind === "mtd") { f = ymdLocal(firstOfMonth(now)); t = ymdLocal(now); }
    else if (kind === "lmonth") { f = ymdLocal(lastMonthFirst(now)); t = ymdLocal(lastMonthLast(now)); }
    else if (kind === "ytd") { f = ymdLocal(ytdFirst(now)); t = ymdLocal(now); }
    else if (kind === "prevperiod") {
      // previous period based on PRIMARY range length
      const len = diffDaysInclusive(from, to);
      const end = addDaysLocal(parseYMD(from)!, -1);
      t = ymdLocal(end);
      f = ymdLocal(addDaysLocal(end, -(len - 1)));
    } else if (kind === "lastyear") {
      const F = parseYMD(which === "main" ? from : cmpFrom)!;
      const T = parseYMD(which === "main" ? to : cmpTo)!;
      f = ymdLocal(new Date(F.getFullYear() - 1, F.getMonth(), F.getDate()));
      t = ymdLocal(new Date(T.getFullYear() - 1, T.getMonth(), T.getDate()));
    }

    if (which === "main") { setFrom(f); setTo(t); }
    else { setCmpFrom(f); setCmpTo(t); }
  }

  const left = primary;
  const right = comparison;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Rep Scorecard</h1>

        {/* PRIMARY selection */}
        <div className="grid" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <b>Primary</b>
            <label className="small muted">Rep</label>
            <select value={primaryRep} onChange={(e) => setPrimaryRep(e.target.value)}>
              <option value="" disabled>— Select rep —</option>
              {allReps.map(r => <option key={r.id || r.name} value={r.name}>{r.name}</option>)}
            </select>

            <div className="small muted">Range:</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <button className="btn" onClick={() => pickRange("today", "main")}>Today</button>
            <button className="btn" onClick={() => pickRange("wtd", "main")}>WTD</button>
            <button className="btn" onClick={() => pickRange("mtd", "main")}>MTD</button>
            <button className="btn" onClick={() => pickRange("ytd", "main")}>YTD</button>
          </div>

          {/* COMPARISON selection */}
          <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <b>Compare to</b>
            <label className="small muted">Rep</label>
            <select value={compareRep} onChange={(e) => setCompareRep(e.target.value)}>
              <option value="">(Same rep)</option>
              {allReps.map(r => <option key={r.id || r.name} value={r.name}>{r.name}</option>)}
            </select>

            <div className="small muted">Range:</div>
            <input type="date" value={cmpFrom} onChange={(e) => setCmpFrom(e.target.value)} />
            <input type="date" value={cmpTo} onChange={(e) => setCmpTo(e.target.value)} />
            <button className="btn" onClick={() => { setCmpFrom(from); setCmpTo(to); }}>Same as primary</button>
            <button className="btn" onClick={() => pickRange("prevperiod", "cmp")}>Previous period</button>
            <button className="btn" onClick={() => pickRange("lastyear", "cmp")}>Same period last year</button>

            <button className="btn" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {err && <div className="small" style={{ color: "#b91c1c" }}>{err}</div>}
      </section>

      {/* Results */}
      {(!left || !right) ? (
        <div className="card">
          <div className="small">Choose reps and ranges, then click Refresh.</div>
        </div>
      ) : (
        <>
          {/* Section 1: Sales & Profit */}
          <section className="card">
            <h3>Sales &amp; Profit</h3>
            <div className="grid" style={{ gap: 8, gridTemplateColumns: "minmax(160px,1fr) 1fr 1fr" }}>
              <div />
              <div className="small muted" style={{ textAlign: "right" }}>
                {left.rep} • {from} → {to}
              </div>
              <div className="small muted" style={{ textAlign: "right" }}>
                {(right.rep || left.rep)} • {cmpFrom} → {cmpTo}
              </div>

              <div style={{ fontWeight: 600 }}>Sales (ex VAT)</div>
              <div style={{ textAlign: "right" }}>
                {fmt(left.salesEx)}
                <PctDelta base={right.salesEx} value={left.salesEx} />
              </div>
              <div style={{ textAlign: "right" }}>{fmt(right.salesEx)}</div>

              <div style={{ fontWeight: 600 }}>Margin %</div>
              <div style={{ textAlign: "right" }}>
                {fmt(left.marginPct, 1)}%
                <PctDelta base={right.marginPct} value={left.marginPct} />
              </div>
              <div style={{ textAlign: "right" }}>{fmt(right.marginPct, 1)}%</div>

              <div style={{ fontWeight: 600 }}>Profit</div>
              <div style={{ textAlign: "right" }}>
                {fmt(left.profit)}
                <PctDelta base={right.profit} value={left.profit} />
              </div>
              <div style={{ textAlign: "right" }}>{fmt(right.profit)}</div>
            </div>
          </section>

          {/* Section 2: Calling */}
          <section className="card">
            <h3>Calling Activity</h3>
            <div className="grid" style={{ gap: 8, gridTemplateColumns: "minmax(160px,1fr) 1fr 1fr" }}>
              <div />
              <div className="small muted" style={{ textAlign: "right" }}>{left.rep}</div>
              <div className="small muted" style={{ textAlign: "right" }}>{right.rep || left.rep}</div>

              <div style={{ fontWeight: 600 }}>Total Calls</div>
              <div style={{ textAlign: "right" }}>
                {fmt(left.totalCalls)}
                <PctDelta base={right.totalCalls} value={left.totalCalls} />
              </div>
              <div style={{ textAlign: "right" }}>{fmt(right.totalCalls)}</div>

              <div style={{ fontWeight: 600 }}>Cold Calls</div>
              <div style={{ textAlign: "right" }}>
                {fmt(left.coldCalls)}
                <PctDelta base={right.coldCalls} value={left.coldCalls} />
              </div>
              <div style={{ textAlign: "right" }}>{fmt(right.coldCalls)}</div>

              <div style={{ fontWeight: 600 }}>Booked Calls</div>
              <div style={{ textAlign: "right" }}>
                {fmt(left.bookedCalls)}
                <PctDelta base={right.bookedCalls} value={left.bookedCalls} />
              </div>
              <div style={{ textAlign: "right" }}>{fmt(right.bookedCalls)}</div>

              <div style={{ fontWeight: 600 }}>Booked Demos</div>
              <div style={{ textAlign: "right" }}>
                {fmt(left.bookedDemos)}
                <PctDelta base={right.bookedDemos} value={left.bookedDemos} />
              </div>
              <div style={{ textAlign: "right" }}>{fmt(right.bookedDemos)}</div>

              <div style={{ fontWeight: 600 }}>Avg Time per Call (mins)</div>
              <div style={{ textAlign: "right" }}>
                {fmt(left.avgTimePerCallMins, 1)}
                <PctDelta base={right.avgTimePerCallMins} value={left.avgTimePerCallMins} />
              </div>
              <div style={{ textAlign: "right" }}>{fmt(right.avgTimePerCallMins, 1)}</div>

              <div style={{ fontWeight: 600 }}>Avg Calls per Day</div>
              <div style={{ textAlign: "right" }}>
                {fmt(left.avgCallsPerDay, 1)}
                <PctDelta base={right.avgCallsPerDay} value={left.avgCallsPerDay} />
              </div>
              <div style={{ textAlign: "right" }}>{fmt(right.avgCallsPerDay, 1)}</div>

              <div style={{ fontWeight: 600 }}>Days Active</div>
              <div style={{ textAlign: "right" }}>
                {fmt(left.daysActive)}
                <PctDelta base={right.daysActive} value={left.daysActive} />
              </div>
              <div style={{ textAlign: "right" }}>{fmt(right.daysActive)}</div>
            </div>
          </section>

          {/* Section 3: Customers */}
          <section className="card">
            <h3>Customer Counts</h3>
            <div className="grid" style={{ gap: 8, gridTemplateColumns: "minmax(160px,1fr) 1fr 1fr" }}>
              <div />
              <div className="small muted" style={{ textAlign: "right" }}>{left.rep}</div>
              <div className="small muted" style={{ textAlign: "right" }}>{right.rep || left.rep}</div>

              <div style={{ fontWeight: 600 }}>Total Customers</div>
              <div style={{ textAlign: "right" }}>
                {fmt(left.totalCustomers)}
                <PctDelta base={right.totalCustomers} value={left.totalCustomers} />
              </div>
              <div style={{ textAlign: "right" }}>{fmt(right.totalCustomers)}</div>

              <div style={{ fontWeight: 600 }}>New Customers</div>
              <div style={{ textAlign: "right" }}>
                {fmt(left.newCustomers)}
                <PctDelta base={right.newCustomers} value={left.newCustomers} />
              </div>
              <div style={{ textAlign: "right" }}>{fmt(right.newCustomers)}</div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
