"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type CallRecord = {
  id: string;
  createdAt: string;
  callType: string | null;
  outcome: string | null;
  staff: string | null;
  isExistingCustomer: boolean;
  customerId: string | null;
  summary: string | null;
  customerName: string | null;
  customer?: { salonName: string; customerName: string } | null;
  durationMinutes?: number | null;
  startTime?: string | null;
  endTime?: string | null;
};

type SalesRepLite = { id: string; name: string };

function pad(n: number) { return String(n).padStart(2, "0"); }
function dt(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getDate().toString().padStart(2,"0")}/${pad(x.getMonth()+1)}/${x.getFullYear()} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

function minutesFor(c: CallRecord): number | null {
  if (typeof c.durationMinutes === "number" && isFinite(c.durationMinutes)) return Math.max(0, Math.round(c.durationMinutes));
  if (c.startTime && c.endTime) {
    const s = new Date(c.startTime).getTime();
    const e = new Date(c.endTime).getTime();
    if (isFinite(s) && isFinite(e) && e > s) return Math.round((e - s) / 60000);
  }
  return null;
}

const CALL_TYPES = ["Cold Call", "Booked Call", "Booked Demo"] as const;
const OUTCOMES   = ["Sale", "No Sale", "Appointment booked", "Demo Booked"] as const;

const OUTCOME_COLOR: Record<string, string> = {
  "sale": "#dcfce7",
  "appointment booked": "#fef9c3",
  "demo booked": "#e0e7ff",
  "no sale": "#fee2e2",
};

export default function CallsListPage() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [callType, setCallType] = useState("");
  const [outcome, setOutcome] = useState("");
  const [rep, setRep] = useState("");
  const [q, setQ] = useState("");
  const [reps, setReps] = useState<SalesRepLite[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sales-reps", { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (Array.isArray(j)) setReps(j as SalesRepLite[]);
        else setReps([]);
      } catch { setReps([]); }
    })();
  }, []);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (callType) p.set("callType", callType);
    if (outcome) p.set("outcome", outcome);
    if (rep) p.set("staff", rep);
    p.set("limit", "100");
    return p.toString();
  }, [from, to, callType, outcome, rep]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/calls?${qs}`, { cache: "no-store" });
      const json = await r.json().catch(() => null);
      if (!r.ok) throw new Error((json && json.error) || "Failed to load calls");
      setCalls(Array.isArray(json) ? json : []);
    } catch (e: any) {
      setCalls([]);
      setError(e?.message || "Failed to load calls");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [qs]);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [auto, qs]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return calls;
    return calls.filter((c) => {
      const a = `${c.customer?.salonName || ""} ${c.customer?.customerName || ""}`.toLowerCase();
      const b = (c.customerName || "").toLowerCase();
      return a.includes(term) || b.includes(term);
    });
  }, [calls, q]);

  const counts = useMemo(() => {
    const byType = new Map<string, number>();
    for (const c of filtered) {
      const k = c.callType || "—";
      byType.set(k, (byType.get(k) || 0) + 1);
    }
    return byType;
  }, [filtered]);

  const activeFilters = [from, to, callType, outcome, rep, q].filter(Boolean).length;

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Header */}
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1>Call Log</h1>
            <p className="small muted">{filtered.length} call{filtered.length !== 1 ? "s" : ""}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className={activeFilters > 0 ? "btn primary" : "btn"}
              onClick={() => setShowFilters(f => !f)}
            >
              {showFilters ? "Hide Filters" : `Filters${activeFilters > 0 ? ` (${activeFilters})` : ""}`}
            </button>
            <button className="btn" onClick={load} disabled={loading}>{loading ? "…" : "Refresh"}</button>
            <Link className="primary" href="/calls/new">+ Log Call</Link>
          </div>
        </div>
      </section>

      {/* Filters — collapsible */}
      {showFilters && (
        <section className="card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            <div className="field"><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="field"><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div className="field">
              <label>Call Type</label>
              <select value={callType} onChange={(e) => setCallType(e.target.value)}>
                <option value="">— Any —</option>
                {CALL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Outcome</label>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value="">— Any —</option>
                {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Sales Rep</label>
              <select value={rep} onChange={(e) => setRep(e.target.value)}>
                <option value="">— Any —</option>
                {reps.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Search customer</label>
              <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Salon or name…" />
            </div>
          </div>
          {activeFilters > 0 && (
            <button className="btn" style={{ marginTop: 10, fontSize: "0.8rem" }} onClick={() => { setFrom(""); setTo(""); setCallType(""); setOutcome(""); setRep(""); setQ(""); }}>
              Clear all filters
            </button>
          )}
        </section>
      )}

      {/* Quick stats */}
      {counts.size > 0 && (
        <section className="card">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[...counts.entries()].map(([k, v]) => (
              <span key={k} className="badge">{k} <span className="small muted">{v}</span></span>
            ))}
          </div>
        </section>
      )}

      {error && (
        <section className="card" style={{ borderColor: "#fecaca", background: "#fef2f2" }}>
          <div className="small" style={{ color: "#991b1b" }}>{error}</div>
        </section>
      )}

      {/* Call cards — mobile friendly */}
      <section className="card">
        {filtered.length === 0 ? (
          <p className="small muted">No results.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {filtered.map((c) => {
              const dur = minutesFor(c);
              const customerLabel = c.isExistingCustomer
                ? (c.customer?.salonName || c.customer?.customerName || "—")
                : (c.customerName || "Lead");
              const outcomeKey = (c.outcome || "").toLowerCase();
              const outcomeColor = OUTCOME_COLOR[outcomeKey] || "#f3f4f6";

              return (
                <div
                  key={c.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 14,
                    background: "#fff",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  {/* Top row: customer + view button */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{customerLabel}</div>
                      <div className="small muted">{dt(c.createdAt)}</div>
                    </div>
                    <Link
                      href={`/calls/${c.id}`}
                      className="btn"
                      style={{ fontSize: "0.8rem", padding: "5px 12px", flexShrink: 0 }}
                    >
                      View
                    </Link>
                  </div>

                  {/* Chips row */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {c.callType && (
                      <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: "0.75rem", fontWeight: 600, background: "#e0e7ff" }}>
                        {c.callType}
                      </span>
                    )}
                    {c.outcome && (
                      <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: "0.75rem", fontWeight: 600, background: outcomeColor }}>
                        {c.outcome}
                      </span>
                    )}
                    {dur !== null && (
                      <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: "0.75rem", background: "#f3f4f6" }}>
                        {dur}m
                      </span>
                    )}
                  </div>

                  {/* Rep + summary */}
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {c.staff && <span className="small muted">👤 {c.staff}</span>}
                    {c.summary && <span className="small muted" style={{ flex: 1 }}>{c.summary.length > 80 ? c.summary.slice(0, 80) + "…" : c.summary}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
