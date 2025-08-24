// app/reports/calls/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Report = {
  generatedAt: string;
  range: { from: string; to: string };
  totals: {
    totalCalls: number;
    bookings: number;
    sales: number;
    callToBookingPct: number;
    apptToSalePct: number;
  };
  byRep: Array<{ staff: string; count: number }>;
};

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDaysLocal(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function mondayOfWeek(d: Date) {
  // Monday = start of week
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDaysLocal(d, delta);
}
function firstOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function lastMonthFirst(d: Date) {
  const m = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return m;
}
function lastMonthLast(d: Date) {
  const firstThis = new Date(d.getFullYear(), d.getMonth(), 1);
  const lastPrev = addDaysLocal(firstThis, -1);
  return lastPrev;
}
function ytdFirst(d: Date) {
  return new Date(d.getFullYear(), 0, 1);
}

export default function CallReportPage() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState<string>(ymdLocal(today));
  const [to, setTo] = useState<string>(ymdLocal(today));

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Report | null>(null);

  async function load(range?: { from: string; to: string }) {
    const f = range?.from ?? from;
    const t = range?.to ?? to;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/reports/calls?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`, {
        cache: "no-store",
      });
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
    load({ from, to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickRange(kind: string) {
    const now = new Date();
    let f = from;
    let t = to;

    if (kind === "today") {
      f = ymdLocal(now);
      t = ymdLocal(now);
    } else if (kind === "yesterday") {
      const y = addDaysLocal(now, -1);
      f = ymdLocal(y);
      t = ymdLocal(y);
    } else if (kind === "wtd") {
      const start = mondayOfWeek(now);
      f = ymdLocal(start);
      t = ymdLocal(now);
    } else if (kind === "lweek") {
      const thisMon = mondayOfWeek(now);
      const lastMon = addDaysLocal(thisMon, -7);
      const lastSun = addDaysLocal(thisMon, -1);
      f = ymdLocal(lastMon);
      t = ymdLocal(lastSun);
    } else if (kind === "mtd") {
      f = ymdLocal(firstOfMonth(now));
      t = ymdLocal(now);
    } else if (kind === "lmonth") {
      f = ymdLocal(lastMonthFirst(now));
      t = ymdLocal(lastMonthLast(now));
    } else if (kind === "ytd") {
      f = ymdLocal(ytdFirst(now));
      t = ymdLocal(now);
    } else if (kind === "custom") {
      const input = prompt(
        "Enter custom range as YYYY-MM-DD to YYYY-MM-DD",
        `${from} to ${to}`
      );
      if (!input) return;
      const m = /^\s*(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\s*$/i.exec(input);
      if (!m) {
        alert("Invalid format. Example: 2025-08-01 to 2025-08-24");
        return;
      }
      f = m[1];
      t = m[2];
    }

    setFrom(f);
    setTo(t);
    load({ from: f, to: t });
  }

  const lastUpdated = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleString()
    : "—";

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1>Call Report</h1>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="primary" onClick={() => pickRange("today")}>Today</button>
            <button className="primary" onClick={() => pickRange("yesterday")}>Yesterday</button>
            <button className="primary" onClick={() => pickRange("wtd")}>Week to date</button>
            <button className="primary" onClick={() => pickRange("lweek")}>Last week</button>
            <button className="primary" onClick={() => pickRange("mtd")}>Month to date</button>
            <button className="primary" onClick={() => pickRange("lmonth")}>Last month</button>
            <button className="primary" onClick={() => pickRange("ytd")}>Year to date</button>
            <button className="primary" onClick={() => pickRange("custom")}>Custom…</button>
            <button className="primary" onClick={() => load()} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="small" style={{ marginTop: 8 }}>
          <div>Range: <b>{from}</b> to <b>{to}</b></div>
          <div>Last updated: <b>{lastUpdated}</b></div>
        </div>
      </section>

      {/* Error */}
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
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {data ? data.totals.totalCalls : "—"}
            </div>
          </div>
          <div className="card">
            <div className="small muted">Appointments Booked</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {data ? data.totals.bookings : "—"}
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Call → Booking: {data ? `${data.totals.callToBookingPct.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div className="card">
            <div className="small muted">Sales</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {data ? data.totals.sales : "—"}
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Booking → Sale: {data ? `${data.totals.apptToSalePct.toFixed(1)}%` : "—"}
            </div>
          </div>
        </div>

        {/* By rep */}
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
