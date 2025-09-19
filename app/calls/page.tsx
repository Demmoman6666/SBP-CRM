// app/calls/page.tsx
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
  /** ⬇️ include typed name for non-existing customers */
  customerName: string | null;
  customer?: { salonName: string; customerName: string } | null;

  /** ⬇️ for duration column */
  durationMinutes?: number | null;
  startTime?: string | null;
  endTime?: string | null;
};

type SalesRepLite = { id: string; name: string };

function pad(n: number) { return String(n).padStart(2, "0"); }
function dt(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

const CALL_TYPES = ["Cold Call", "Booked Call", "Booked Demo"] as const;
const OUTCOMES   = ["Sale", "No Sale", "Appointment booked", "Demo Booked"] as const;

// derive duration in minutes
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

export default function CallsListPage() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);

  // filters
  const [from, setFrom] = useState<string>(""); // yyyy-mm-dd
  const [to, setTo] = useState<string>("");
  const [callType, setCallType] = useState<string>("");
  const [outcome, setOutcome] = useState<string>("");
  const [rep, setRep] = useState<string>("");

  // NEW: client-side search by customer name
  const [q, setQ] = useState<string>("");

  // sales reps for dropdown
  const [reps, setReps] = useState<SalesRepLite[]>([]);
  useEffect(() => { (async () => {
    try {
      const r = await fetch("/api/sales-reps", { cache: "no-store" });
      if (r.ok) setReps(await r.json());
    } catch {}
  })(); }, []);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to)   p.set("to", to);
    if (callType) p.set("callType", callType);
    if (outcome)  p.set("outcome", outcome);
    if (rep)      p.set("staff", rep);
    p.set("limit", "100");
    return p.toString();
  }, [from, to, callType, outcome, rep]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/calls?${qs}`, { cache: "no-store" });
      if (r.ok) setCalls(await r.json());
    } finally {
      setLoading(false);
    }
  }

  // initial + whenever filters change
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [qs]);

  // auto-refresh
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(load, 10000); // 10s
    return () => clearInterval(t);
  }, [auto, qs]); // refresh with new filters too

  // NEW: apply client-side customer search
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return calls;
    return calls.filter((c) => {
      const a = `${c.customer?.salonName || ""} ${c.customer?.customerName || ""}`.toLowerCase();
      const b = (c.customerName || "").toLowerCase(); // manual typed name for non-existing customers
      return a.includes(term) || b.includes(term);
    });
  }, [calls, q]);

  // quick stats (based on filtered list so it matches what you see)
  const counts = useMemo(() => {
    const byType = new Map<string, number>();
    for (const c of filtered) {
      const k = c.callType || "—";
      byType.set(k, (byType.get(k) || 0) + 1);
    }
    return byType;
  }, [filtered]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Call Log</h1>
            <p className="small">Live list of calls with filters.</p>
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <span className="small muted">Auto-refresh</span>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              <span className="small">{auto ? "On" : "Off"}</span>
            </label>
            <button className="btn" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
            <Link className="primary" href="/calls/new">Log Call</Link>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="card">
        <div className="grid" style={{ gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
          <div>
            <label>Date from</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label>Date to</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label>Call Type</label>
            <select value={callType} onChange={(e) => setCallType(e.target.value)}>
              <option value="">— Any —</option>
              {CALL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label>Outcome</label>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">— Any —</option>
              {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label>Sales Rep</label>
            <select value={rep} onChange={(e) => setRep(e.target.value)}>
              <option value="">— Any —</option>
              {reps.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          </div>

          {/* NEW: Customer search */}
          <div>
            <label>Search customer</label>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type salon or customer name…"
            />
          </div>
        </div>
      </section>

      {/* Quick stats */}
      <section className="card">
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          {[...counts.entries()].map(([k, v]) => (
            <span key={k} className="badge">{k}<span className="small muted"> {v}</span></span>
          ))}
          {counts.size === 0 && <span className="small muted">No calls yet for current filters.</span>}
        </div>
      </section>

      {/* Results */}
      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 160 }}>Logged</th>
              <th style={{ width: 160 }}>Sales Rep</th>
              <th>Customer</th>
              <th style={{ width: 150 }}>Type</th>
              <th style={{ width: 190 }}>Outcome</th>
              {/* Duration column */}
              <th style={{ width: 140 }}>Duration (mins)</th>
              <th>Summary</th>
              {/* Actions header */}
              <th style={{ width: 110, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const dur = minutesFor(c);
              return (
                <tr key={c.id}>
                  <td className="small">{dt(c.createdAt)}</td>
                  <td className="small">{c.staff || "—"}</td>
                  <td className="small">
                    {c.isExistingCustomer
                      ? (c.customer?.salonName || c.customer?.customerName || "—")
                      : (c.customerName || "Lead")}
                  </td>
                  <td className="small">{c.callType || "—"}</td>
                  <td className="small">{c.outcome || "—"}</td>
                  <td className="small">{dur ?? "—"}</td>
                  <td className="small">{c.summary || "—"}</td>
                  <td style={{ width: 110, textAlign: "right" }}>
                    <Link
                      href={`/calls/${c.id}`}
                      className="btn"
                      style={{ padding: "4px 10px", height: 28, lineHeight: "20px", borderRadius: 999 }}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8}><div className="small muted">No results.</div></td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
