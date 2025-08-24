// app/reports/calls/page.tsx
"use client";
import { useEffect, useMemo, useState } from "react";

type Report = {
  generatedAt: string;
  range: { label: string; since: string; until: string };
  totals: { totalCalls: number; appointments: number; sales: number; callToBookingPct: number; apptToSalePct: number };
  byRep: { staff: string; count: number }[];
};

export default function CallReportPage() {
  const [rangeKey, setRangeKey] = useState("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ range: rangeKey });
    if (rangeKey === "custom") {
      if (customStart) p.set("start", new Date(customStart).toISOString());
      if (customEnd) p.set("end", new Date(customEnd).toISOString());
    }
    return p.toString();
  }, [rangeKey, customStart, customEnd]);

  async function load(signal?: AbortSignal) {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/reports/calls?${qs}`, { cache: "no-store", headers: { "x-no-cache": "1" }, signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load report");
      setData(json); setLastUpdated(new Date());
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e.message || "Failed to load report");
    } finally { setLoading(false); }
  }

  // live-ish updates: 5s poll (lower to 3s if you want)
  useEffect(() => {
    const ctl = new AbortController();
    load(ctl.signal);
    const h = setInterval(() => load(), 5000);
    return () => { ctl.abort(); clearInterval(h); };
  }, [qs]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1>Call Report</h1>
          <div className="small muted">
            Range: {data ? `${data.range.label} • ${new Date(data.range.since).toLocaleString()} → ${new Date(data.range.until).toLocaleString()}` : "—"}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}
            {data?.generatedAt ? ` • generated ${new Date(data.generatedAt).toLocaleTimeString()}` : ""}
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          {["today","yesterday","wtd","lastweek","mtd","lastmonth","ytd","custom"].map(k => (
            <button key={k} className={k===rangeKey ? "primary" : "btn"} onClick={() => setRangeKey(k)}>
              {({today:"Today",yesterday:"Yesterday",wtd:"Week to date",lastweek:"Last week",mtd:"Month to date",lastmonth:"Last month",ytd:"Year to date",custom:"Custom…"} as any)[k]}
            </button>
          ))}
          {rangeKey==="custom" && (
            <div className="row" style={{ gap:6 }}>
              <input type="datetime-local" value={customStart} onChange={e=>setCustomStart(e.target.value)}/>
              <span>–</span>
              <input type="datetime-local" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}/>
              <button className="btn" onClick={()=>load()} disabled={loading}>Apply</button>
            </div>
          )}
          <button className="btn" onClick={()=>load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </section>

      {/* …your existing metrics + by-rep list… */}
    </div>
  );
}
