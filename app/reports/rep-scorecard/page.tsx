// app/reports/rep-scorecard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/** ---------- Types ---------- */
type Rep = { id: string; name: string };

type Scorecard = {
  rep: string;
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

/** ---------- Small helpers ---------- */
function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function ymdLocal(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function addDaysLocal(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function mondayOfWeek(d: Date) { const dow = d.getDay(); const delta = dow === 0 ? -6 : 1 - dow; return addDaysLocal(d, delta); }
function firstOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastMonthFirst(d: Date) { return new Date(d.getFullYear(), d.getMonth()-1, 1); }
function lastMonthLast(d: Date) { const firstThis = new Date(d.getFullYear(), d.getMonth(), 1); return addDaysLocal(firstThis, -1); }
function ytdFirst(d: Date) { return new Date(d.getFullYear(), 0, 1); }
const fmt = (n: number | null | undefined, dp = 0) =>
  n == null || isNaN(n as number) ? "—" : Number(n).toFixed(dp);

/** Colored % delta vs baseline */
function PctDelta({ base, value }: { base: number; value: number }) {
  if (!isFinite(base) || base === 0) return <span className="small muted" style={{ marginLeft: 6 }}>—</span>;
  const pct = ((value - base) / Math.abs(base)) * 100;
  const color = pct > 0 ? "#16a34a" : pct < 0 ? "#b91c1c" : "var(--muted)";
  const sign = pct > 0 ? "+" : "";
  return (
    <span className="small" style={{ marginLeft: 6, color }}>
      {sign}{pct.toFixed(1)}%
    </span>
  );
}

/** Normalize /api/sales-reps result (strings or objects) */
function normalizeReps(j: any): Rep[] {
  const arr = Array.isArray(j) ? j : Array.isArray(j?.reps) ? j.reps : [];
  return arr
    .map((r: any): Rep =>
      typeof r === "string"
        ? { id: r, name: r }
        : { id: String(r?.id ?? r?.name ?? ""), name: String(r?.name ?? r?.id ?? "") }
    )
    .filter((r: Rep) => !!r.name);
}

export default function RepScorecardPage() {
  /** Date range */
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState<string>(ymdLocal(today));
  const [to, setTo] = useState<string>(ymdLocal(today));

  /** Reps + multi-select for comparison */
  const [allReps, setAllReps] = useState<Rep[]>([]);
  const [selected, setSelected] = useState<string[]>([]); // rep names

  /** Data by rep */
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Scorecard[]>([]);

  /** Load reps list */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sales-reps", { cache: "no-store", credentials: "include" });
        const j = await r.json().catch(() => null);
        const reps = normalizeReps(j);
        setAllReps(reps);
        // sensible default: first 2
        setSelected((cur) => cur.length ? cur : reps.slice(0, 2).map(x => x.name));
      } catch {
        setAllReps([]);
      }
    })();
  }, []);

  /** Fetch scorecards for selected reps */
  async function load(range?: { from?: string; to?: string; reps?: string[] }) {
    const f = range?.from ?? from;
    const t = range?.to ?? to;
    const reps = (range?.reps ?? selected).filter(Boolean);
    if (reps.length === 0) { setRows([]); return; }

    setLoading(true);
    setErr(null);
    try {
      const datasets = await Promise.all(
        reps.map(async (name) => {
          const qs = new URLSearchParams({ from: f, to: t, rep: name });
          const res = await fetch(`/api/reports/rep-scorecard?${qs.toString()}`, {
            cache: "no-store",
            credentials: "include",
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json?.error || "Failed to load");
          // Expect backend to return the full scorecard for this rep
          return json as Scorecard;
        })
      );
      setRows(datasets);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  /** initial load */
  useEffect(() => {
    if (selected.length) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function pickRange(kind: string) {
    const now = new Date();
    let f = from, t = to;

    if (kind === "today") { f = ymdLocal(now); t = ymdLocal(now); }
    else if (kind === "yesterday") { const y = addDaysLocal(now, -1); f = ymdLocal(y); t = ymdLocal(y); }
    else if (kind === "wtd") { const start = mondayOfWeek(now); f = ymdLocal(start); t = ymdLocal(now); }
    else if (kind === "lweek") { const thisMon = mondayOfWeek(now); f = ymdLocal(addDaysLocal(thisMon, -7)); t = ymdLocal(addDaysLocal(thisMon, -1)); }
    else if (kind === "mtd") { f = ymdLocal(firstOfMonth(now)); t = ymdLocal(now); }
    else if (kind === "lmonth") { f = ymdLocal(lastMonthFirst(now)); t = ymdLocal(lastMonthLast(now)); }
    else if (kind === "ytd") { f = ymdLocal(ytdFirst(now)); t = ymdLocal(now); }

    setFrom(f); setTo(t);
    load({ from: f, to: t });
  }

  /** UI helpers */
  const base = rows[0]; // baseline for Δ%

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>Rep Scorecard</h1>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => pickRange("today")}>Today</button>
            <button className="btn" onClick={() => pickRange("yesterday")}>Yesterday</button>
            <button className="btn" onClick={() => pickRange("wtd")}>Week to date</button>
            <button className="btn" onClick={() => pickRange("lweek")}>Last week</button>
            <button className="btn" onClick={() => pickRange("mtd")}>Month to date</button>
            <button className="btn" onClick={() => pickRange("lmonth")}>Last month</button>
            <button className="btn" onClick={() => pickRange("ytd")}>Year to date</button>
          </div>
        </div>

        {/* Range + Compare dropdown */}
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="small muted">
            Range: <b>{from}</b> to <b>{to}</b>
          </div>

          {/* Compare multi-select */}
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label className="small muted">Compare reps</label>
            <select
              multiple
              value={selected}
              onChange={(e) => {
                const vals = Array.from(e.currentTarget.selectedOptions).map((o) => o.value);
                setSelected(vals);
                load({ reps: vals });
              }}
              size={Math.min(6, Math.max(2, allReps.length))}
            >
              {allReps.map((r) => (
                <option key={r.id || r.name} value={r.name}>{r.name}</option>
              ))}
            </select>
            <button className="btn" onClick={() => load()} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="small muted">
          Tip: first selected rep is used as the baseline for <span style={{ color: "#16a34a" }}>+% up</span> /
          <span style={{ color: "#b91c1c" }}> -% down</span> comparisons.
        </div>
      </section>

      {err && (
        <div className="card" style={{ borderColor: "#fca5a5" }}>
          <div className="small" style={{ color: "#b91c1c" }}>{err}</div>
        </div>
      )}

      {/* Nothing selected */}
      {!rows.length && !loading && (
        <div className="card">
          <div className="small">Select one or more reps to view the scorecard.</div>
        </div>
      )}

      {!!rows.length && (
        <>
          {/* Section 1 */}
          <section className="card">
            <h3>Sales &amp; Profit</h3>
            <div className="grid" style={{ gap: 8, gridTemplateColumns: `200px repeat(${rows.length}, minmax(140px, 1fr))` }}>
              <div className="small muted" />
              {rows.map((r) => (
                <div key={`h1-${r.rep}`} className="small muted" style={{ textAlign: "right" }}>{r.rep}</div>
              ))}

              <div style={{ fontWeight: 600 }}>Sales (ex VAT)</div>
              {rows.map((r) => (
                <div key={`s-${r.rep}`} style={{ textAlign: "right" }}>
                  {fmt(r.salesEx)}
                  {base && base.rep !== r.rep && <PctDelta base={base.salesEx} value={r.salesEx} />}
                </div>
              ))}

              <div style={{ fontWeight: 600 }}>Margin %</div>
              {rows.map((r) => (
                <div key={`m-${r.rep}`} style={{ textAlign: "right" }}>
                  {fmt(r.marginPct, 1)}%
                  {base && base.rep !== r.rep && <PctDelta base={base.marginPct} value={r.marginPct} />}
                </div>
              ))}

              <div style={{ fontWeight: 600 }}>Profit</div>
              {rows.map((r) => (
                <div key={`p-${r.rep}`} style={{ textAlign: "right" }}>
                  {fmt(r.profit)}
                  {base && base.rep !== r.rep && <PctDelta base={base.profit} value={r.profit} />}
                </div>
              ))}
            </div>
          </section>

          {/* Section 2 */}
          <section className="card">
            <h3>Calling Activity</h3>
            <div className="grid" style={{ gap: 8, gridTemplateColumns: `200px repeat(${rows.length}, minmax(140px, 1fr))` }}>
              <div className="small muted" />
              {rows.map((r) => (
                <div key={`h2-${r.rep}`} className="small muted" style={{ textAlign: "right" }}>{r.rep}</div>
              ))}

              <div style={{ fontWeight: 600 }}>Total Calls</div>
              {rows.map((r) => (
                <div key={`tc-${r.rep}`} style={{ textAlign: "right" }}>
                  {fmt(r.totalCalls)}
                  {base && base.rep !== r.rep && <PctDelta base={base.totalCalls} value={r.totalCalls} />}
                </div>
              ))}

              <div style={{ fontWeight: 600 }}>Cold Calls</div>
              {rows.map((r) => (
                <div key={`cc-${r.rep}`} style={{ textAlign: "right" }}>
                  {fmt(r.coldCalls)}
                  {base && base.rep !== r.rep && <PctDelta base={base.coldCalls} value={r.coldCalls} />}
                </div>
              ))}

              <div style={{ fontWeight: 600 }}>Booked Calls</div>
              {rows.map((r) => (
                <div key={`bc-${r.rep}`} style={{ textAlign: "right" }}>
                  {fmt(r.bookedCalls)}
                  {base && base.rep !== r.rep && <PctDelta base={base.bookedCalls} value={r.bookedCalls} />}
                </div>
              ))}

              <div style={{ fontWeight: 600 }}>Booked Demos</div>
              {rows.map((r) => (
                <div key={`bd-${r.rep}`} style={{ textAlign: "right" }}>
                  {fmt(r.bookedDemos)}
                  {base && base.rep !== r.rep && <PctDelta base={base.bookedDemos} value={r.bookedDemos} />}
                </div>
              ))}

              <div style={{ fontWeight: 600 }}>Avg Time per Call (mins)</div>
              {rows.map((r) => (
                <div key={`at-${r.rep}`} style={{ textAlign: "right" }}>
                  {fmt(r.avgTimePerCallMins, 1)}
                  {base && base.rep !== r.rep && <PctDelta base={base.avgTimePerCallMins} value={r.avgTimePerCallMins} />}
                </div>
              ))}

              <div style={{ fontWeight: 600 }}>Avg Calls per Day</div>
              {rows.map((r) => (
                <div key={`apd-${r.rep}`} style={{ textAlign: "right" }}>
                  {fmt(r.avgCallsPerDay, 1)}
                  {base && base.rep !== r.rep && <PctDelta base={base.avgCallsPerDay} value={r.avgCallsPerDay} />}
                </div>
              ))}

              <div style={{ fontWeight: 600 }}>Days Active</div>
              {rows.map((r) => (
                <div key={`da-${r.rep}`} style={{ textAlign: "right" }}>
                  {fmt(r.daysActive)}
                  {base && base.rep !== r.rep && <PctDelta base={base.daysActive} value={r.daysActive} />}
                </div>
              ))}
            </div>
          </section>

          {/* Section 3 */}
          <section className="card">
            <h3>Customer Counts</h3>
            <div className="grid" style={{ gap: 8, gridTemplateColumns: `200px repeat(${rows.length}, minmax(140px, 1fr))` }}>
              <div className="small muted" />
              {rows.map((r) => (
                <div key={`h3-${r.rep}`} className="small muted" style={{ textAlign: "right" }}>{r.rep}</div>
              ))}

              <div style={{ fontWeight: 600 }}>Total Customers</div>
              {rows.map((r) => (
                <div key={`tcust-${r.rep}`} style={{ textAlign: "right" }}>
                  {fmt(r.totalCustomers)}
                  {base && base.rep !== r.rep && <PctDelta base={base.totalCustomers} value={r.totalCustomers} />}
                </div>
              ))}

              <div style={{ fontWeight: 600 }}>New Customers</div>
              {rows.map((r) => (
                <div key={`ncust-${r.rep}`} style={{ textAlign: "right" }}>
                  {fmt(r.newCustomers)}
                  {base && base.rep !== r.rep && <PctDelta base={base.newCustomers} value={r.newCustomers} />}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
