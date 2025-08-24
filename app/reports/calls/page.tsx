// app/reports/calls/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Report = {
  generatedAt: string;
  range: { from: string; to: string };
  filter?: { staff: string | null };
  totals: {
    totalCalls: number;
    bookings: number;
    sales: number;
    callToBookingPct: number;
    apptToSalePct: number;
    callToSalePct: number;
    bookedCalls: number;
    bookedCallSales: number;
    bookedCallToSalePct: number;
    /** ✅ NEW */
    totalDurationMinutes: number;
    avgDurationMinutes: number;
  };
  byRep: Array<{ staff: string; count: number }>;
};

type Rep = { id: string; name: string };

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function ymdLocal(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function addDaysLocal(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function mondayOfWeek(d: Date) { const dow = d.getDay(); const delta = dow === 0 ? -6 : 1 - dow; return addDaysLocal(d, delta); }
function firstOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastMonthFirst(d: Date) { return new Date(d.getFullYear(), d.getMonth()-1, 1); }
function lastMonthLast(d: Date) { const firstThis = new Date(d.getFullYear(), d.getMonth(), 1); return addDaysLocal(firstThis, -1); }
function ytdFirst(d: Date) { return new Date(d.getFullYear(), 0, 1); }

// Small “chip” button (subtle, wraps well)
function Chip(props: { onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      className="btn"
      onClick={props.onClick}
      title={props.title}
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "#fff",
      }}
    >
      {props.children}
    </button>
  );
}

export default function CallReportPage() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState<string>(ymdLocal(today));
  const [to, setTo] = useState<string>(ymdLocal(today));

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Report | null>(null);

  // Sales Rep filter
  const [reps, setReps] = useState<Rep[]>([]);
  const [repFilter, setRepFilter] = useState<string>(""); // "" = All reps

  useEffect(() => {
    fetch("/api/sales-reps", { cache: "no-store" })
      .then(r => r.json())
      .then((list: Rep[]) => setReps(list ?? []))
      .catch(() => setReps([]));
  }, []);

  async function load(range?: { from: string; to: string; staff?: string }) {
    const f = range?.from ?? from;
    const t = range?.to ?? to;
    const staff = range?.staff ?? repFilter;

    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ from: f, to: t });
      if (staff) qs.set("staff", staff);
      const res = await fetch(`/api/reports/calls?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load report");
      setData(json as Report);
    } catch (e: any) {
      setErr(e?.message || "Failed to load report");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // initial fetch (Today)
  useEffect(() => {
    load({ from, to, staff: repFilter });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    else if (kind === "custom") {
      const input = prompt("Enter custom range as YYYY-MM-DD to YYYY-MM-DD", `${from} to ${to}`);
      if (!input) return;
      const m = /^\s*(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\s*$/i.exec(input);
      if (!m) { alert("Invalid format. Example: 2025-08-01 to 2025-08-24"); return; }
      f = m[1]; t = m[2];
    }

    setFrom(f); setTo(t);
    load({ from: f, to: t, staff: repFilter });
  }

  const lastUpdated = data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : "—";

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Row 1: Title + Last updated + Refresh */}
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>Call Report</h1>
          <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div className="small muted">Last updated: <b>{lastUpdated}</b></div>
            <Chip onClick={() => load()} title="Refresh now">
              {loading ? "Refreshing…" : "Refresh"}
            </Chip>
          </div>
        </div>

        {/* Row 2: Sales Rep selector + Date chips */}
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label className="small muted">Sales Rep</label>
            <select
              value={repFilter}
              onChange={(e) => { setRepFilter(e.target.value); load({ from, to, staff: e.target.value }); }}
            >
              <option value="">All reps</option>
              {reps.map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Chip onClick={() => pickRange("today")}>Today</Chip>
            <Chip onClick={() => pickRange("yesterday")}>Yesterday</Chip>
            <Chip onClick={() => pickRange("wtd")}>Week to date</Chip>
            <Chip onClick={() => pickRange("lweek")}>Last week</Chip>
            <Chip onClick={() => pickRange("mtd")}>Month to date</Chip>
            <Chip onClick={() => pickRange("lmonth")}>Last month</Chip>
            <Chip onClick={() => pickRange("ytd")}>Year to date</Chip>
            <Chip onClick={() => pickRange("custom")}>Custom…</Chip>
          </div>
        </div>

        {/* Row 3: Range summary */}
        <div className="small muted">
          Range: <b>{from}</b> to <b>{to}</b>
          {repFilter ? <> • Rep: <b>{repFilter}</b></> : null}
        </div>
      </section>

      {err && (
        <div className="card" style={{ borderColor: "#fca5a5" }}>
          <div className="small" style={{ color: "#b91c1c" }}>{err}</div>
        </div>
      )}

      {/* Totals */}
      <section className="grid" style={{ gap: 12 }}>
        <div className="grid grid-3">
          <div className="card">
            <div className="small muted">Total Calls</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{data ? data.totals.totalCalls : "—"}</div>
          </div>
          <div className="card">
            <div className="small muted">Appointments Booked</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{data ? data.totals.bookings : "—"}</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Call → Booking: {data ? `${data.totals.callToBookingPct.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div className="card">
            <div className="small muted">Sales</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{data ? data.totals.sales : "—"}</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Booking → Sale: {data ? `${data.totals.apptToSalePct.toFixed(1)}%` : "—"}
            </div>
            <div className="small muted" style={{ marginTop: 2 }}>
              Call → Sale: {data ? `${data.totals.callToSalePct.toFixed(1)}%` : "—"}
            </div>
          </div>
        </div>

        {/* ✅ NEW: Duration cards */}
        <div className="grid grid-2">
          <div className="card">
            <div className="small muted">Total Duration (mins)</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {data ? Math.round(data.totals.totalDurationMinutes) : "—"}
            </div>
          </div>
          <div className="card">
            <div className="small muted">Average Duration (mins)</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {data ? data.totals.avgDurationMinutes.toFixed(1) : "—"}
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              (Total Duration ÷ Calls)
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Booked Calls → Sales</h3>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {data ? data.totals.bookedCallSales : "—"}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            of {data ? data.totals.bookedCalls : "—"} booked calls •{" "}
            {data ? `${data.totals.bookedCallToSalePct.toFixed(1)}%` : "—"}
          </div>
        </div>

        <div className="card">
          <h3>Calls by Sales Rep</h3>
          {!data || data.byRep.length === 0 ? (
            <p className="small">No calls for this range.</p>
          ) : (
            <div className="grid">
              <div className="row" style={{ fontWeight: 600, borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
                <div style={{ flex: 2 }}>Sales Rep</div>
                <div style={{ width: 120, textAlign: "right" }}>Calls</div>
                <div style={{ width: 120, textAlign: "right" }}>% of total</div>
              </div>
              {data.byRep.map((r) => (
                <div className="row" key={r.staff} style={{ borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                  <div style={{ flex: 2 }}>{r.staff}</div>
                  <div style={{ width: 120, textAlign: "right" }}>{r.count}</div>
                  <div style={{ width: 120, textAlign: "right" }}>
                    {data.totals.totalCalls > 0
                      ? ((r.count / data.totals.totalCalls) * 100).toFixed(1) + "%"
                      : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
