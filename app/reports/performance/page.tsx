"use client";

import { useEffect, useMemo, useState, useRef } from "react";

type Rep = { id: string; name: string };
type ScoreData = {
  ok: boolean;
  range: { from: string; to: string };
  rep: { id: string | null; name: string | null };
  currency: string;
  section1: {
    salesEx: number; profit: number; marginPct: number;
    ordersCount: number; avgOrderValueExVat: number;
    firstTimeBuyerAov: number | null; firstTimeBuyerCount: number;
  };
  section2: {
    totalCalls: number; coldCalls: number; bookedCalls: number; bookedDemos: number;
    firstBookedCalls: number; sampleReviews: number; accountManage: number;
    coldCallsToAppointment: number; firstBookedToAppointment: number; sampleReviewsToSale: number;
    avgTimePerCallMins: number; avgCallsPerDay: number; activeDays: number;
  };
  section3: { totalCustomers: number; newCustomers: number; activeCustomers: number };
};

function pad(n: number) { return String(n).padStart(2, "0"); }
function toYmd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fmtMoney(n: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number) { return `${n.toFixed(1)}%`; }
function fmtMins(n: number) {
  if (!n) return "0m";
  const h = Math.floor(n / 60); const m = Math.round(n % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function conv(num: number, den: number) {
  if (!den) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

function getRange(preset: string): { from: string; to: string } {
  const now = new Date(); const today = toYmd(now);
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") { const d = new Date(now); d.setDate(d.getDate()-1); const y = toYmd(d); return { from: y, to: y }; }
  if (preset === "wtd") { const d = new Date(now); d.setDate(d.getDate()-((d.getDay()+6)%7)); return { from: toYmd(d), to: today }; }
  if (preset === "last_week") {
    const mon = new Date(now); mon.setDate(mon.getDate()-((mon.getDay()+6)%7)-7);
    const sun = new Date(mon); sun.setDate(sun.getDate()+6);
    return { from: toYmd(mon), to: toYmd(sun) };
  }
  if (preset === "mtd") return { from: toYmd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  if (preset === "last_month") {
    const f = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const t = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: toYmd(f), to: toYmd(t) };
  }
  if (preset === "qtd") {
    const q = Math.floor(now.getMonth()/3);
    return { from: toYmd(new Date(now.getFullYear(), q*3, 1)), to: today };
  }
  if (preset === "ytd") return { from: toYmd(new Date(now.getFullYear(), 0, 1)), to: today };
  if (preset === "last_year") return { from: `${now.getFullYear()-1}-01-01`, to: `${now.getFullYear()-1}-12-31` };
  return { from: toYmd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
}

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "wtd", label: "Week to date" },
  { key: "last_week", label: "Last week" },
  { key: "mtd", label: "Month to date" },
  { key: "last_month", label: "Last month" },
  { key: "qtd", label: "Quarter to date" },
  { key: "ytd", label: "Year to date" },
  { key: "last_year", label: "Last year" },
  { key: "custom", label: "Custom" },
];

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color: color || "var(--text)", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SectionHead({ title, icon }: { title: string; icon: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 10, borderBottom: "2px solid var(--pink)", marginBottom: 14 }}>
      <span style={{ fontSize: "1.1rem" }}>{icon}</span>
      <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{title}</h2>
    </div>
  );
}

export default function PerformanceDashboard() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [selectedRepId, setSelectedRepId] = useState("");
  const [preset, setPreset] = useState("mtd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<ScoreData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRun, setAutoRun] = useState(false);
  const hasRun = useRef(false);

  useEffect(() => {
    fetch("/api/sales-reps", { cache: "no-store" })
      .then(r => r.json()).then(j => setReps(Array.isArray(j) ? j : [])).catch(() => setReps([]));
  }, []);

  const range = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    return getRange(preset);
  }, [preset, customFrom, customTo]);

  async function run(overrideRepId?: string) {
    const repId = overrideRepId !== undefined ? overrideRepId : selectedRepId;
    if (!range.from || !range.to) { setError("Please select a date range"); return; }
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (repId) qs.set("repId", repId);
      const r = await fetch(`/api/reports/rep-scorecard?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed");
      setData(j);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!hasRun.current) { hasRun.current = true; run(); }
  }, []);

  useEffect(() => {
    if (autoRun && hasRun.current) run();
  }, [range, selectedRepId, autoRun]);

  const s1 = data?.section1;
  const s2 = data?.section2;
  const s3 = data?.section3;
  const currency = data?.currency || "GBP";

  function formatDateRange() {
    if (!range.from || !range.to) return "";
    const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
    const f = new Date(range.from).toLocaleDateString("en-GB", opts);
    const t = new Date(range.to).toLocaleDateString("en-GB", opts);
    return range.from === range.to ? f : `${f} – ${t}`;
  }

  const gridStyle = { display: "grid" as const, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 };

  return (
    <div className="grid" style={{ gap: 16 }}>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" as const, gap: 10 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>Performance Dashboard</h1>
            <p className="small muted">
              {data ? formatDateRange() + (data.rep.name ? " · " + data.rep.name : " · All reps") : "Set filters and run"}
            </p>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--muted)", fontWeight: 500 }}>
            <input type="checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} />
            Auto-refresh
          </label>
        </div>
      </section>

      <section className="card" style={{ overflow: "visible" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Sales Rep</label>
            <select value={selectedRepId} onChange={e => setSelectedRepId(e.target.value)}>
              <option value="">All reps</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          {preset === "custom" && (
            <>
              <div className="field" style={{ margin: 0 }}><label>From</label><input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></div>
              <div className="field" style={{ margin: 0 }}><label>To</label><input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} /></div>
            </>
          )}
        </div>

        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 8 }}>Date Range</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
            {PRESETS.map(p => (
              <button key={p.key} onClick={() => setPreset(p.key)} style={{ padding: "6px 14px", borderRadius: 999, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", border: "1px solid var(--border)", background: preset === p.key ? "var(--pink)" : "#fff", color: preset === p.key ? "#fff" : "var(--text)" }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" as const }}>
          <button className="primary" onClick={() => run()} disabled={loading} style={{ minWidth: 100 }}>
            {loading ? "Running..." : "Run"}
          </button>
          {preset === "custom" && (
            <span className="small muted">Select From/To dates above then click Run</span>
          )}
        </div>

        {error && <div className="small" style={{ color: "var(--red)", marginTop: 8 }}>{error}</div>}
      </section>

      {loading && (
        <section className="card" style={{ textAlign: "center" as const, padding: 40 }}>
          <p className="small muted">Loading…</p>
        </section>
      )}

      {data && !loading && (
        <>
          <section className="card">
            <SectionHead title="Sales & Revenue" icon="💰" />
            <div style={gridStyle}>
              <StatCard label="Revenue (ex VAT)" value={fmtMoney(s1?.salesEx || 0, currency)} />
              <StatCard label="Gross Profit" value={fmtMoney(s1?.profit || 0, currency)} sub={`${fmtPct(s1?.marginPct || 0)} margin`} color="#16a34a" />
              <StatCard label="Total Orders" value={s1?.ordersCount || 0} />
              <StatCard label="Avg Order Value" value={s1?.avgOrderValueExVat ? fmtMoney(s1.avgOrderValueExVat, currency) : "—"} sub="ex VAT" />
              <StatCard label="First-Time Buyer AOV" value={s1?.firstTimeBuyerAov ? fmtMoney(s1.firstTimeBuyerAov, currency) : "—"} sub={s1?.firstTimeBuyerCount ? `${s1.firstTimeBuyerCount} new buyers` : undefined} />
            </div>
          </section>

          <section className="card">
            <SectionHead title="Call Activity" icon="📞" />
            <div style={gridStyle}>
              <StatCard label="Total Calls" value={s2?.totalCalls || 0} />
              <StatCard label="Active Days" value={s2?.activeDays || 0} sub="Days with calls logged" />
              <StatCard label="Avg Calls / Day" value={(s2?.avgCallsPerDay || 0).toFixed(1)} />
              <StatCard label="Total Duration" value={fmtMins((s2?.avgTimePerCallMins || 0) * (s2?.totalCalls || 0))} />
              <StatCard label="Avg Duration / Call" value={fmtMins(s2?.avgTimePerCallMins || 0)} />
            </div>
          </section>

          <section className="card">
            <SectionHead title="Call Types" icon="📋" />
            <div style={gridStyle}>
              <StatCard label="Cold Calls" value={s2?.coldCalls || 0} />
              <StatCard label="1st Booked Calls" value={s2?.firstBookedCalls || 0} />
              <StatCard label="Sample Reviews" value={s2?.sampleReviews || 0} />
              <StatCard label="Account Manage" value={s2?.accountManage || 0} />
              <StatCard label="Booked Demos" value={s2?.bookedDemos || 0} />
              <StatCard label="Booked Calls" value={s2?.bookedCalls || 0} />
            </div>
          </section>

          <section className="card">
            <SectionHead title="Conversion Rates" icon="🎯" />
            <div style={gridStyle}>
              <StatCard label="Cold Call → Appt" value={conv(s2?.coldCallsToAppointment || 0, s2?.coldCalls || 0)} sub={`${s2?.coldCallsToAppointment || 0} of ${s2?.coldCalls || 0}`} color="#2563eb" />
              <StatCard label="1st Booked → Appt" value={conv(s2?.firstBookedToAppointment || 0, s2?.firstBookedCalls || 0)} sub={`${s2?.firstBookedToAppointment || 0} of ${s2?.firstBookedCalls || 0}`} color="#2563eb" />
              <StatCard label="Sample Review → Sale" value={conv(s2?.sampleReviewsToSale || 0, s2?.sampleReviews || 0)} sub={`${s2?.sampleReviewsToSale || 0} of ${s2?.sampleReviews || 0}`} color="#16a34a" />
              <StatCard label="Overall Call → Sale" value={conv(s1?.ordersCount || 0, s2?.totalCalls || 0)} sub={`${s1?.ordersCount || 0} orders from ${s2?.totalCalls || 0} calls`} color="#16a34a" />
            </div>
          </section>

          <section className="card">
            <SectionHead title="Customers" icon="🏪" />
            <div style={gridStyle}>
              <StatCard label="Total Customers" value={s3?.totalCustomers || 0} />
              <StatCard label="New This Period" value={s3?.newCustomers || 0} color="var(--pink-dark)" />
              <StatCard label="Active Buyers" value={s3?.activeCustomers || 0} sub="Placed an order" color="#16a34a" />
              <StatCard label="Inactive" value={(s3?.totalCustomers || 0) - (s3?.activeCustomers || 0)} sub="No orders this period" color="var(--muted)" />
            </div>
          </section>

          {!selectedRepId && reps.length > 1 && (
            <section className="card">
              <SectionHead title="Rep Comparison" icon="📊" />
              <p className="small muted" style={{ marginBottom: 12 }}>Click a rep to drill into their individual scorecard.</p>
              <div style={{ display: "grid", gap: 8 }}>
                {reps.map(r => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "#fff", flexWrap: "wrap" as const, gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{r.name}</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => { setSelectedRepId(r.id); run(r.id); }}>
                        View scorecard
                      </button>
                      <a href={`/reps/${r.id}`} className="btn" style={{ fontSize: "0.8rem" }}>Rep profile</a>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
