// app/reports/calls/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* Types for API response */
type CallsByRep = { staff: string | null; count: number };
type CallReport = {
  range: { from: string; to: string };
  totals: {
    totalCalls: number;
    bookings: number;
    sales: number;
    callToBookingPct: number;      // bookings / totalCalls
    apptToSalePct: number;         // sales / bookings
  };
  byRep: CallsByRep[];
};

/* Date helpers */
function startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function startOfWeek(d = new Date()) { const x = new Date(d); const day = (x.getDay()+6)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x; } // Mon
function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfLastMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth()-1, 1); }
function endOfLastMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 0); }
function startOfYear(d = new Date()) { return new Date(d.getFullYear(), 0, 1); }

function fmtISO(d: Date) { return d.toISOString().slice(0,10); }

type Preset =
  | "today" | "yesterday"
  | "wtd" | "lastweek"
  | "mtd" | "lastmonth"
  | "ytd" | "custom";

export default function CallReportPage() {
  const [preset, setPreset] = useState<Preset>("today");
  const [from, setFrom] = useState<string>(fmtISO(startOfToday()));
  const [to, setTo] = useState<string>(fmtISO(startOfToday()));
  const [data, setData] = useState<CallReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Update dates when preset changes (non-custom)
  useEffect(() => {
    if (preset === "custom") return;
    const today = startOfToday();
    if (preset === "today") {
      setFrom(fmtISO(today)); setTo(fmtISO(today));
    } else if (preset === "yesterday") {
      const y = addDays(today,-1);
      setFrom(fmtISO(y)); setTo(fmtISO(y));
    } else if (preset === "wtd") {
      setFrom(fmtISO(startOfWeek(today)));
      setTo(fmtISO(today));
    } else if (preset === "lastweek") {
      const end = addDays(startOfWeek(today), -1);
      const start = addDays(end, -6);
      setFrom(fmtISO(start)); setTo(fmtISO(end));
    } else if (preset === "mtd") {
      setFrom(fmtISO(startOfMonth(today)));
      setTo(fmtISO(today));
    } else if (preset === "lastmonth") {
      setFrom(fmtISO(startOfLastMonth()));
      setTo(fmtISO(endOfLastMonth()));
    } else if (preset === "ytd") {
      setFrom(fmtISO(startOfYear(today)));
      setTo(fmtISO(today));
    }
  }, [preset]);

  const canFetch = useMemo(() => !!from && !!to, [from, to]);

  async function load() {
    if (!canFetch) return;
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/calls?from=${from}&to=${to}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to load report");
      setData(j);
    } catch (e: any) {
      setErr(e?.message || "Failed to load report");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* auto-load on first mount & preset change */ }, [from, to]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Call Report</h1>
        <p className="small">Volumes by rep, bookings &amp; conversions. Choose a date range.</p>

        {/* Presets */}
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {[
            ["today","Today"],
            ["yesterday","Yesterday"],
            ["wtd","Week to date"],
            ["lastweek","Last week"],
            ["mtd","Month to date"],
            ["lastmonth","Last month"],
            ["ytd","Year to date"],
            ["custom","Custom"],
          ].map(([key,label]) => (
            <button
              key={key}
              className="btn"
              onClick={() => setPreset(key as Preset)}
              style={{
                background: preset === key ? "var(--pink)" : "#fff",
                border: "1px solid var(--border)"
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom range */}
        {preset === "custom" && (
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <div>
              <label className="small">From</label>
              <input type="date" value={from} onChange={(e)=>setFrom(e.target.value)} />
            </div>
            <div>
              <label className="small">To</label>
              <input type="date" value={to} onChange={(e)=>setTo(e.target.value)} />
            </div>
            <div className="row" style={{ alignItems:"flex-end" }}>
              <button className="primary" onClick={load}>Run</button>
            </div>
          </div>
        )}
      </section>

      {/* KPIs */}
      <section className="grid grid-2" style={{ gap: 12 }}>
        <div className="card">
          <h3>Totals</h3>
          {loading ? <p className="small">Loading…</p> : err ? <p className="form-error">{err}</p> : data ? (
            <div className="grid" style={{ gap: 8 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="small muted">Date range</div>
                <div className="small">{data.range.from} → {data.range.to}</div>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>Total calls</div>
                <div><b>{data.totals.totalCalls}</b></div>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>Appointments booked</div>
                <div><b>{data.totals.bookings}</b></div>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>Call → Booking</div>
                <div><b>{data.totals.callToBookingPct.toFixed(1)}%</b></div>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>Sales</div>
                <div><b>{data.totals.sales}</b></div>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>Appointment → Sale</div>
                <div><b>{data.totals.apptToSalePct.toFixed(1)}%</b></div>
              </div>
            </div>
          ) : <p className="small muted">No data.</p>}
        </div>

        <div className="card">
          <h3>Calls by Sales Rep</h3>
          {loading ? <p className="small">Loading…</p> : err ? <p className="form-error">{err}</p> : data && data.byRep.length ? (
            <table className="table">
              <thead>
                <tr><th>Sales Rep</th><th>Calls</th></tr>
              </thead>
              <tbody>
                {data.byRep.map((r) => (
                  <tr key={r.staff ?? "unassigned"}>
                    <td>{r.staff || "Unassigned"}</td>
                    <td>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="small muted">No calls in range.</p>}
        </div>
      </section>
    </div>
  );
}
