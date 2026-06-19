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

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function dt(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  return pad(x.getDate()) + "/" + pad(x.getMonth() + 1) + "/" + x.getFullYear() + " " + pad(x.getHours()) + ":" + pad(x.getMinutes());
}
function shortDt(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  return pad(x.getDate()) + "/" + pad(x.getMonth() + 1) + " " + pad(x.getHours()) + ":" + pad(x.getMinutes());
}

const CALL_TYPES = ["Cold Call", "Booked Call", "Booked Demo"];
const OUTCOMES = ["Sale", "No Sale", "Appointment booked", "Demo Booked"];

function minutesFor(c: CallRecord): number | null {
  if (typeof c.durationMinutes === "number" && isFinite(c.durationMinutes)) {
    return Math.max(0, Math.round(c.durationMinutes));
  }
  if (c.startTime && c.endTime) {
    const s = new Date(c.startTime).getTime();
    const e = new Date(c.endTime).getTime();
    if (isFinite(s) && isFinite(e) && e > s) {
      return Math.round((e - s) / 60000);
    }
  }
  return null;
}

function outcomeColor(outcome: string | null) {
  if (!outcome) return { bg: "#f3f4f6", fg: "var(--muted)" };
  const k = outcome.toLowerCase();
  if (k.includes("sale") && !k.includes("no")) return { bg: "#dcfce7", fg: "#166534" };
  if (k.includes("no sale")) return { bg: "#fee2e2", fg: "#991b1b" };
  if (k.includes("appointment") || k.includes("demo")) return { bg: "#fef9c3", fg: "#854d0e" };
  return { bg: "#f3f4f6", fg: "var(--muted)" };
}

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
    fetch("/api/sales-reps", { cache: "no-store" })
      .then(r => r.json())
      .then(j => {
        if (Array.isArray(j)) setReps(j);
        else if (j && j.ok && Array.isArray(j.reps)) setReps(j.reps.map((name: string) => ({ id: name, name })));
        else setReps([]);
      })
      .catch(() => setReps([]));
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

  function load() {
    setLoading(true);
    setError(null);
    fetch("/api/calls?" + qs, { cache: "no-store" })
      .then(r => r.json().then(json => ({ ok: r.ok, json })))
      .then(({ ok, json }) => {
        if (!ok) throw new Error((json && json.error) || "Failed to load calls");
        setCalls(Array.isArray(json) ? json : []);
      })
      .catch((e: any) => {
        setCalls([]);
        setError(e?.message || "Failed to load calls");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [qs]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [auto, qs]);

  const filtered = useMemo(() => {
    const arr = Array.isArray(calls) ? calls : [];
    const term = q.trim().toLowerCase();
    if (!term) return arr;
    return arr.filter(c => {
      const a = ((c.customer?.salonName || "") + " " + (c.customer?.customerName || "")).toLowerCase();
      const b = (c.customerName || "").toLowerCase();
      return a.includes(term) || b.includes(term);
    });
  }, [calls, q]);

  const counts = useMemo(() => {
    const byType = new Map<string, number>();
    for (const c of filtered) {
      const k = c.callType || "Unspecified";
      byType.set(k, (byType.get(k) || 0) + 1);
    }
    return byType;
  }, [filtered]);

  const activeFilterCount = [from, to, callType, outcome, rep].filter(Boolean).length;

  function clearFilters() {
    setFrom(""); setTo(""); setCallType(""); setOutcome(""); setRep("");
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1 style={{ marginBottom: 2 }}>Call Log</h1>
            <p className="small muted">{loading ? "Refreshing..." : filtered.length + " calls"}</p>
          </div>
          <Link className="primary" href="/calls/new">+ Log Call</Link>
        </div>
      </section>

      <section className="card">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "1 1 200px", margin: 0 }}>
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search customer or salon..."
            />
          </div>
          <button
            className="btn"
            onClick={() => setShowFilters(v => !v)}
            style={{ position: "relative" }}
          >
            Filters{activeFilterCount > 0 ? " (" + activeFilterCount + ")" : ""}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: "var(--muted)" }}>
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
            Auto-refresh
          </label>
        </div>

        {showFilters && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Date Range</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {[
                    { label: "Today", days: 0 },
                    { label: "Yesterday", days: 1, single: true },
                    { label: "Last 7 days", days: 7 },
                    { label: "Last 30 days", days: 30 },
                    { label: "This month", thisMonth: true },
                  ].map(preset => (
                    <button
                      key={preset.label}
                      className="btn"
                      style={{ fontSize: "0.75rem", padding: "4px 10px" }}
                      onClick={() => {
                        const now = new Date();
                        const toStr = now.toISOString().slice(0, 10);
                        if (preset.thisMonth) {
                          const first = new Date(now.getFullYear(), now.getMonth(), 1);
                          setFrom(first.toISOString().slice(0, 10));
                          setTo(toStr);
                        } else if (preset.single) {
                          const d = new Date(now);
                          d.setDate(d.getDate() - preset.days!);
                          const s = d.toISOString().slice(0, 10);
                          setFrom(s);
                          setTo(s);
                        } else {
                          const d = new Date(now);
                          d.setDate(d.getDate() - preset.days!);
                          setFrom(d.toISOString().slice(0, 10));
                          setTo(toStr);
                        }
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                  {(from || to) && (
                    <button className="btn" style={{ fontSize: "0.75rem", padding: "4px 10px" }} onClick={() => { setFrom(""); setTo(""); }}>
                      Clear dates
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ flex: 1 }} />
                  <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ flex: 1 }} />
                </div>
              </div>
              <div className="field">
                <label>Call Type</label>
                <select value={callType} onChange={e => setCallType(e.target.value)}>
                  <option value="">Any</option>
                  {CALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Outcome</label>
                <select value={outcome} onChange={e => setOutcome(e.target.value)}>
                  <option value="">Any</option>
                  {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Sales Rep</label>
                <select value={rep} onChange={e => setRep(e.target.value)}>
                  <option value="">Any</option>
                  {reps.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                </select>
              </div>
            </div>
            {activeFilterCount > 0 && (
              <button className="btn" style={{ marginTop: 10, fontSize: "0.8rem" }} onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </section>

      {counts.size > 0 && (
        <section className="card">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Array.from(counts.entries()).map(([k, v]) => (
              <span key={k} style={{ padding: "5px 12px", borderRadius: 999, background: "var(--surface-2)", fontSize: "0.8rem", fontWeight: 600 }}>
                {k} <span style={{ color: "var(--muted)", fontWeight: 400 }}>{v}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {error && (
        <section className="card" style={{ borderColor: "#fecaca", background: "#fef2f2" }}>
          <div className="small" style={{ color: "#991b1b" }}>{error}</div>
        </section>
      )}

      <section className="card">
        {filtered.length === 0 ? (
          <p className="small muted" style={{ textAlign: "center", padding: "20px 0" }}>No calls match your filters.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {filtered.map(c => {
              const dur = minutesFor(c);
              const oc = outcomeColor(c.outcome);
              const customerLabel = c.isExistingCustomer
                ? (c.customer?.salonName || c.customer?.customerName || "Unknown")
                : (c.customerName || "Lead");
              return (
                <Link
                  key={c.id}
                  href={"/calls/" + c.id}
                  style={{ display: "block", textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "#fff", padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: "0.95rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {customerLabel}
                        </div>
                        <div className="small muted">{shortDt(c.createdAt)}{c.staff ? " - " + c.staff : ""}</div>
                      </div>
                      <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600, background: oc.bg, color: oc.fg, flexShrink: 0 }}>
                        {c.outcome || "No outcome"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      {c.callType && <span className="small muted">{c.callType}</span>}
                      {dur !== null && <span className="small muted">{dur}m</span>}
                    </div>
                    {c.summary && (
                      <div className="small muted" style={{ marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {c.summary}
                      </div>
                    )}
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
