"use client";

import { useEffect, useState, useRef } from "react";

type Rep = { id: string; name: string };

function pad(n: number) { return String(n).padStart(2, "0"); }
function toYmd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

function getRange(preset: string) {
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
  if (preset === "ytd") return { from: toYmd(new Date(now.getFullYear(), 0, 1)), to: today };
  return { from: toYmd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
}

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "wtd", label: "Week to date" },
  { key: "last_week", label: "Last week" },
  { key: "mtd", label: "Month to date" },
  { key: "last_month", label: "Last month" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom" },
];

const FOCUS_OPTIONS = [
  { key: "calls", label: "Call Performance", desc: "Call volumes, types, duration and activity patterns" },
  { key: "conversions", label: "Conversion Analysis", desc: "Cold call to appointment, sample review to sale rates" },
  { key: "sales", label: "Sales Performance", desc: "Revenue, order values, new customers and trends" },
  { key: "customers", label: "Customer Insights", desc: "Customer engagement, inactivity and opportunities" },
  { key: "coaching", label: "Coaching Report", desc: "What the rep is doing well and specific areas to improve" },
  { key: "full", label: "Full Analysis", desc: "Everything — comprehensive report across all dimensions" },
];

export default function AIReportPage() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [selectedRepId, setSelectedRepId] = useState("");
  const [preset, setPreset] = useState("mtd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [focusKeys, setFocusKeys] = useState<string[]>(["full"]);
  const [extraContext, setExtraContext] = useState("");
  const [report, setReport] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataPreview, setDataPreview] = useState<any>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/sales-reps", { cache: "no-store" })
      .then(r => r.json()).then(j => setReps(Array.isArray(j) ? j : [])).catch(() => setReps([]));
  }, []);

  const range = preset === "custom" ? { from: customFrom, to: customTo } : getRange(preset);

  function toggleFocus(key: string) {
    if (key === "full") { setFocusKeys(["full"]); return; }
    setFocusKeys(prev => {
      const without = prev.filter(k => k !== "full");
      if (without.includes(key)) {
        const next = without.filter(k => k !== key);
        return next.length === 0 ? ["full"] : next;
      }
      return [...without, key];
    });
  }

  async function generate() {
    if (!range.from || !range.to) { setError("Please select a date range"); return; }
    setLoading(true); setError(null); setReport(""); setDataPreview(null);

    try {
      // Step 1: Fetch the data
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (selectedRepId) qs.set("repId", selectedRepId);

      const [scorecardRes, callsRes] = await Promise.all([
        fetch(`/api/reports/rep-scorecard?${qs}`, { cache: "no-store" }),
        fetch(`/api/calls?from=${range.from}&to=${range.to}${selectedRepId ? `&repId=${selectedRepId}` : ""}&limit=500`, { cache: "no-store" }),
      ]);

      const scorecard = await scorecardRes.json();
      const calls = callsRes.ok ? await callsRes.json() : [];

      setDataPreview({ callCount: Array.isArray(calls) ? calls.length : 0, scorecard });

      const selectedRep = reps.find(r => r.id === selectedRepId);
      const repName = selectedRep?.name || scorecard?.rep?.name || "All Reps";
      const dateLabel = `${range.from} to ${range.to}`;
      const focusLabels = focusKeys.includes("full") ? "Full analysis" : focusKeys.map(k => FOCUS_OPTIONS.find(o => o.key === k)?.label).join(", ");

      // Build call log summary for AI
      const callSummaries = Array.isArray(calls) ? calls.slice(0, 200).map((c: any) => ({
        date: c.createdAt?.slice(0, 10),
        type: c.callType || "Unknown",
        outcome: c.outcome || "Unknown",
        customer: c.customer?.salonName || c.customerName || "Unknown",
        duration: c.durationMinutes || 0,
        summary: c.summary ? c.summary.slice(0, 150) : null,
        staff: c.staff || null,
      })) : [];

      const s1 = scorecard?.section1 || {};
      const s2 = scorecard?.section2 || {};
      const s3 = scorecard?.section3 || {};

      const prompt = `You are a senior sales performance analyst for Salon Brands Pro, a professional hair and beauty product distributor in South Wales, UK. You specialise in field sales rep performance analysis.

ANALYSIS REQUEST
Rep: ${repName}
Period: ${dateLabel}
Focus: ${focusLabels}
${extraContext ? `Additional context from manager: ${extraContext}` : ""}

QUANTITATIVE DATA
Sales & Revenue:
- Revenue (ex VAT): £${(s1.salesEx || 0).toFixed(2)}
- Gross Profit: £${(s1.profit || 0).toFixed(2)} (${(s1.marginPct || 0).toFixed(1)}% margin)
- Total Orders: ${s1.ordersCount || 0}
- Average Order Value: £${(s1.avgOrderValueExVat || 0).toFixed(2)}
- First-Time Buyer AOV: ${s1.firstTimeBuyerAov ? `£${s1.firstTimeBuyerAov.toFixed(2)}` : "N/A"}
- New Buyers This Period: ${s1.firstTimeBuyerCount || 0}

Call Activity:
- Total Calls Logged: ${s2.totalCalls || 0}
- Active Days: ${s2.activeDays || 0}
- Average Calls Per Day: ${(s2.avgCallsPerDay || 0).toFixed(1)}
- Average Call Duration: ${(s2.avgTimePerCallMins || 0).toFixed(1)} minutes
- Total Time in Field: ${Math.round((s2.avgTimePerCallMins || 0) * (s2.totalCalls || 0))} minutes

Call Types:
- Cold Calls: ${s2.coldCalls || 0}
- 1st Booked Calls: ${s2.firstBookedCalls || 0}
- Sample Reviews: ${s2.sampleReviews || 0}
- Account Management: ${s2.accountManage || 0}
- Booked Demos: ${s2.bookedDemos || 0}

Conversion Rates:
- Cold Call → Appointment: ${s2.coldCalls ? Math.round(((s2.coldCallsToAppointment||0)/(s2.coldCalls||1))*100) : 0}% (${s2.coldCallsToAppointment || 0} of ${s2.coldCalls || 0})
- 1st Booked → Appointment: ${s2.firstBookedCalls ? Math.round(((s2.firstBookedToAppointment||0)/(s2.firstBookedCalls||1))*100) : 0}% (${s2.firstBookedToAppointment || 0} of ${s2.firstBookedCalls || 0})
- Sample Review → Sale: ${s2.sampleReviews ? Math.round(((s2.sampleReviewsToSale||0)/(s2.sampleReviews||1))*100) : 0}% (${s2.sampleReviewsToSale || 0} of ${s2.sampleReviews || 0})

Customers:
- Total Assigned: ${s3.totalCustomers || 0}
- New This Period: ${s3.newCustomers || 0}
- Active Buyers: ${s3.activeCustomers || 0}
- Inactive (no order): ${(s3.totalCustomers || 0) - (s3.activeCustomers || 0)}

CALL LOG DETAILS (${callSummaries.length} calls):
${callSummaries.map((c, i) => `${i+1}. [${c.date}] ${c.type} | ${c.customer} | Outcome: ${c.outcome} | Duration: ${c.duration}m${c.summary ? ` | Notes: "${c.summary}"` : ""}`).join("\n")}

INSTRUCTIONS
Write a professional, honest and actionable performance report. Structure it as follows:

## Executive Summary
2-3 sentence overview of this rep's performance this period.

## What's Working Well
3-5 specific positives with data to back them up.

## Areas for Improvement
3-5 specific areas where performance could be stronger, with concrete suggestions.

## Call Log Insights
Analysis of the actual call log entries — patterns in what's being discussed, common outcomes, quality of notes, and anything notable.

## Conversion Funnel Analysis
Walk through the funnel from cold call to sale. Where is the biggest drop-off? What would move the needle most?

## Recommendations
3-5 prioritised, actionable recommendations the manager can discuss with the rep in their next 1:1.

## Key Metrics Snapshot
A brief bullet summary of the most important numbers.

Be direct and specific. Use the actual data. Don't be vague. If something is concerning, say so clearly. If something is impressive, say so. This report will be used in a real sales management 1:1 meeting.`;

      // Step 2: Call our server-side API route (keeps API key secure)
      const aiRes = await fetch("/api/ai/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const aiJson = await aiRes.json();
      if (!aiRes.ok) throw new Error(aiJson?.error || "AI request failed");
      const text = aiJson?.text || "";
      if (!text) throw new Error("No response from AI");
      setReport(text);

      setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e: any) {
      setError(e.message || "Failed to generate report");
    } finally {
      setLoading(false);
    }
  }

  // Render markdown-style report
  function renderReport(text: string) {
    const lines = text.split("\n");
    return lines.map((line, i) => {
      if (line.startsWith("## ")) return <h2 key={i} style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: 20, marginBottom: 8, color: "var(--text)", paddingBottom: 6, borderBottom: "2px solid var(--pink)" }}>{line.slice(3)}</h2>;
      if (line.startsWith("### ")) return <h3 key={i} style={{ fontSize: "0.95rem", fontWeight: 700, marginTop: 14, marginBottom: 6 }}>{line.slice(4)}</h3>;
      if (line.startsWith("- ") || line.startsWith("• ")) return <li key={i} style={{ marginLeft: 20, marginBottom: 4, fontSize: "0.9rem", lineHeight: 1.6 }}>{line.slice(2)}</li>;
      if (line.startsWith("**") && line.endsWith("**")) return <p key={i} style={{ fontWeight: 700, margin: "6px 0", fontSize: "0.9rem" }}>{line.slice(2, -2)}</p>;
      if (line.trim() === "") return <div key={i} style={{ height: 6 }} />;
      return <p key={i} style={{ margin: "4px 0", fontSize: "0.9rem", lineHeight: 1.7 }}>{line}</p>;
    });
  }

  return (
    <div className="grid" style={{ gap: 16 }}>

      {/* Header */}
      <section className="card">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" as const }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: "1.5rem" }}>✨</span>
              <h1 style={{ margin: 0 }}>AI Performance Report</h1>
            </div>
            <p className="small muted">Select a rep, date range and focus areas. Claude will read the actual call logs and generate a detailed, actionable report.</p>
          </div>
        </div>
      </section>

      {/* Config */}
      <section className="card" style={{ overflow: "visible" }}>
        <h2 style={{ marginBottom: 14 }}>Report Settings</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
          <div className="field">
            <label>Sales Rep</label>
            <select value={selectedRepId} onChange={e => setSelectedRepId(e.target.value)}>
              <option value="">All reps combined</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Date Range</label>
            <select value={preset} onChange={e => setPreset(e.target.value)}>
              {PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
        </div>

        {preset === "custom" && (
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" as const }}>
            <div className="field"><label>From</label><input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></div>
            <div className="field"><label>To</label><input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} /></div>
          </div>
        )}

        {/* Focus areas */}
        <div style={{ marginBottom: 16 }}>
          <label>Focus Areas</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, marginTop: 6 }}>
            {FOCUS_OPTIONS.map(opt => {
              const active = focusKeys.includes(opt.key);
              return (
                <div
                  key={opt.key}
                  onClick={() => toggleFocus(opt.key)}
                  style={{
                    padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                    border: active ? "2px solid var(--pink)" : "1px solid var(--border)",
                    background: active ? "var(--pink-light)" : "#fff",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.85rem", color: active ? "var(--pink-dark)" : "var(--text)" }}>{opt.label}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 2 }}>{opt.desc}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Extra context */}
        <div className="field" style={{ marginBottom: 16 }}>
          <label>Additional context for AI (optional)</label>
          <textarea
            value={extraContext}
            onChange={e => setExtraContext(e.target.value)}
            placeholder="e.g. This rep is in their first 3 months. We recently launched a new Neal & Wolf range. Focus on new customer acquisition..."
            rows={3}
            style={{ height: "auto" }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="primary" onClick={generate} disabled={loading} style={{ fontSize: "0.95rem", padding: "10px 24px" }}>
            {loading ? "Analysing…" : "✨ Generate AI Report"}
          </button>
          {dataPreview && !loading && (
            <span className="small muted">Analysed {dataPreview.callCount} calls</span>
          )}
        </div>

        {error && <div className="small" style={{ color: "var(--red)", marginTop: 8 }}>{error}</div>}
      </section>

      {/* Loading state */}
      {loading && (
        <section className="card" style={{ textAlign: "center" as const, padding: 48 }}>
          <div style={{ fontSize: "2rem", marginBottom: 12 }}>✨</div>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>Claude is analysing the data…</p>
          <p className="small muted">Reading call logs, calculating metrics and writing your report. This takes 15-30 seconds.</p>
        </section>
      )}

      {/* Report output */}
      {report && !loading && (
        <section className="card" ref={reportRef}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap" as const, gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "1.2rem" }}>✨</span>
              <h2 style={{ margin: 0 }}>AI Analysis</h2>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                style={{ fontSize: "0.8rem" }}
                onClick={() => {
                  const blob = new Blob([report], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `ai-report-${range.from}-${range.to}.txt`;
                  a.click(); URL.revokeObjectURL(url);
                }}
              >
                Download
              </button>
              <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => navigator.clipboard?.writeText(report)}>
                Copy
              </button>
              <button className="btn" style={{ fontSize: "0.8rem" }} onClick={generate}>
                Regenerate
              </button>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, lineHeight: 1.7 }}>
            {renderReport(report)}
          </div>
        </section>
      )}
    </div>
  );
}
