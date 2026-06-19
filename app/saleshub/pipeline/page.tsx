"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Stage = "LEAD" | "ENGAGED" | "APPOINTMENT_BOOKED" | "SAMPLING" | "CUSTOMER";

type Counts = {
  LEAD: number;
  ENGAGED: number;
  APPOINTMENT_BOOKED: number;
  SAMPLING: number;
  CUSTOMER: number;
  total: number;
};

type Row = {
  id: string;
  salonName: string;
  customerName: string | null;
  salesRep: string | null;
  stage: Stage;
  createdAt: string;
};

const STAGE_ORDER: Stage[] = ["LEAD", "ENGAGED", "APPOINTMENT_BOOKED", "SAMPLING", "CUSTOMER"];
const STAGE_LABELS: Record<Stage, string> = {
  LEAD: "Lead",
  ENGAGED: "Engaged",
  APPOINTMENT_BOOKED: "Appointment Booked",
  SAMPLING: "Sampling",
  CUSTOMER: "Customer",
};
const STAGE_COLORS: Record<Stage, { bg: string; fg: string; bar: string }> = {
  LEAD: { bg: "#e0e7ff", fg: "#3730a3", bar: "#818cf8" },
  ENGAGED: { bg: "#dbeafe", fg: "#1e40af", bar: "#60a5fa" },
  APPOINTMENT_BOOKED: { bg: "#fef9c3", fg: "#92400e", bar: "#facc15" },
  SAMPLING: { bg: "#fce7f3", fg: "#9d174d", bar: "#f472b6" },
  CUSTOMER: { bg: "#dcfce7", fg: "#166534", bar: "#4ade80" },
};

function daysAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "1 day ago";
  return d + " days ago";
}

export default function PipelinePage() {
  const [rep, setRep] = useState("");
  const [reps, setReps] = useState<{ id: string; name: string }[]>([]);
  const [stageFilter, setStageFilter] = useState<Stage | "">("");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sales-reps", { cache: "no-store" })
      .then(r => r.json())
      .then(j => setReps(Array.isArray(j) ? j : []))
      .catch(() => setReps([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ take: "300" });
    if (rep) qs.set("rep", rep);
    if (stageFilter) qs.set("stage", stageFilter);
    fetch("/api/pipeline?" + qs.toString(), { cache: "no-store" })
      .then(r => r.json())
      .then(j => {
        setCounts(j.counts || null);
        setRows(Array.isArray(j.items) ? j.items : []);
      })
      .catch(() => { setCounts(null); setRows([]); })
      .finally(() => setLoading(false));
  }, [rep, stageFilter]);

  const maxCount = useMemo(() => {
    if (!counts) return 1;
    return Math.max(1, ...STAGE_ORDER.map(s => counts[s]));
  }, [counts]);

  const conversionRates = useMemo(() => {
    if (!counts) return [];
    const rates: { from: Stage; to: Stage; pct: number }[] = [];
    for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
      const from = STAGE_ORDER[i];
      const to = STAGE_ORDER[i + 1];
      // Cumulative: how many reached `to` or beyond, vs how many reached `from` or beyond
      const reachedFrom = STAGE_ORDER.slice(i).reduce((s, st) => s + counts[st], 0);
      const reachedTo = STAGE_ORDER.slice(i + 1).reduce((s, st) => s + counts[st], 0);
      const pct = reachedFrom > 0 ? Math.round((reachedTo / reachedFrom) * 100) : 0;
      rates.push({ from, to, pct });
    }
    return rates;
  }, [counts]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1 style={{ marginBottom: 2 }}>Pipeline</h1>
            <p className="small muted">Track customers through the funnel from first contact to paying customer.</p>
          </div>
          <Link href="/customers/new" className="primary">+ New Customer</Link>
        </div>
      </section>

      <section className="card">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Sales Rep</label>
            <select value={rep} onChange={e => setRep(e.target.value)}>
              <option value="">All reps</option>
              {reps.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* Funnel visual */}
      <section className="card">
        <h2 style={{ marginBottom: 14 }}>Funnel</h2>
        {loading || !counts ? (
          <p className="small muted">Loading...</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {STAGE_ORDER.map((stage, i) => {
              const count = counts[stage];
              const pct = Math.round((count / maxCount) * 100);
              const colors = STAGE_COLORS[stage];
              const isActive = stageFilter === stage;
              return (
                <div key={stage}>
                  <button
                    onClick={() => setStageFilter(isActive ? "" : stage)}
                    style={{
                      width: "100%", textAlign: "left", background: "none", border: "none",
                      padding: 0, cursor: "pointer", display: "block",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: "0.875rem", color: isActive ? colors.fg : "var(--text)" }}>
                        {STAGE_LABELS[stage]}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{count}</span>
                    </div>
                    <div style={{ height: 28, background: "var(--surface-2)", borderRadius: 8, overflow: "hidden", border: isActive ? "2px solid " + colors.bar : "1px solid var(--border)" }}>
                      <div style={{ height: "100%", width: pct + "%", background: colors.bar, borderRadius: 6, transition: "width 0.4s ease", minWidth: count > 0 ? 8 : 0 }} />
                    </div>
                  </button>
                  {i < STAGE_ORDER.length - 1 && conversionRates[i] && (
                    <div style={{ textAlign: "center", padding: "4px 0", fontSize: "0.7rem", color: "var(--muted)" }}>
                      {conversionRates[i].pct}% progress to {STAGE_LABELS[conversionRates[i].to]}
                    </div>
                  )}
                </div>
              );
            })}
            {stageFilter && (
              <button className="btn" style={{ fontSize: "0.8rem", marginTop: 4, width: "fit-content" }} onClick={() => setStageFilter("")}>
                Clear filter
              </button>
            )}
          </div>
        )}
      </section>

      {/* Customer list */}
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>
            {stageFilter ? STAGE_LABELS[stageFilter] : "All"} Customers
          </h2>
          <span className="small muted">{rows.length} shown</span>
        </div>
        {loading ? (
          <p className="small muted">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="small muted" style={{ textAlign: "center", padding: "20px 0" }}>No customers found.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {rows.map(c => {
              const colors = STAGE_COLORS[c.stage] || STAGE_COLORS.LEAD;
              return (
                <Link key={c.id} href={"/customers/" + c.id} style={{ textDecoration: "none", color: "inherit" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "#fff", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.salonName}
                      </div>
                      <div className="small muted">
                        {c.customerName}{c.salesRep ? " - " + c.salesRep : ""} - {daysAgo(c.createdAt)}
                      </div>
                    </div>
                    <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600, background: colors.bg, color: colors.fg, flexShrink: 0 }}>
                      {STAGE_LABELS[c.stage] || c.stage}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
