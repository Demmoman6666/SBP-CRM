// app/reports/targets/page.tsx
"use client";

import { useEffect, useState } from "react";

type Rep = { id: string; name: string };
type Scorecard = {
  rep: { id: string; name: string };
  range: { start: string; end: string; prevStart: string; prevEnd: string };
  metrics: {
    revenue: { actual: number; target: number; attainmentPct: number | null; growthPct: number | null; currency: string };
    orders: { actual: number; target: number; attainmentPct: number | null; growthPct: number | null };
    newCustomers: { actual: number; target: number; attainmentPct: number | null };
  };
  vendors: { vendor: string; revenue: number }[];
};

function monthStr(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthRange(month: string) {
  // month = "YYYY-MM"
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day of month
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}
function fmtPct(v: number | null | undefined) {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}
function money(n: number, c = "GBP") {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(n || 0);
  } catch {
    return `${c} ${(n || 0).toFixed(2)}`;
  }
}

/** Normalise /api/sales-reps to [{id,name}] so filters don't change */
function normaliseReps(j: any): Rep[] {
  if (Array.isArray(j)) {
    return j.map((r: any) => ({
      id: String(r?.id ?? r?.name ?? ""),
      name: String(r?.name ?? r?.id ?? ""),
    })).filter(r => r.id && r.name);
  }
  if (j?.ok && Array.isArray(j.reps)) {
    // fallback string list -> use name as id to keep the UI usable
    return j.reps.map((name: any) => ({ id: String(name || ""), name: String(name || "") })).filter(r => r.id);
  }
  return [];
}

export default function TargetsAndScorecards() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [repId, setRepId] = useState<string>("");
  const [month, setMonth] = useState<string>(monthStr());
  const [revTarget, setRevTarget] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [score, setScore] = useState<Scorecard | null>(null);

  // Load reps (no filter changes)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sales-reps", { cache: "no-store", credentials: "include" });
        const j = await r.json().catch(() => null);
        const list = normaliseReps(j);
        setReps(list);
        if (!repId && list.length) setRepId(list[0].id); // keep behaviour the same
      } catch {
        setReps([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load existing target for selected month/rep
  useEffect(() => {
    if (!repId || !month) return;
    (async () => {
      setMsg(null);
      try {
        const { start, end } = monthRange(month);
        const qs = new URLSearchParams({
          scope: "REP",
          metric: "REVENUE",
          repId,        // ← always send repId (as before)
          start,
          end,
        });
        const r = await fetch(`/api/targets?${qs.toString()}`, { cache: "no-store", credentials: "include" });
        const j = await r.json();
        const t = Array.isArray(j?.targets) ? j.targets[0] : null;
        setRevTarget(t ? String(t.amount) : "");
      } catch {
        // keep quiet; user can still enter a target
      }
    })();
  }, [repId, month]);

  async function saveTarget() {
    if (!repId || !month) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "REP",
          metric: "REVENUE",
          repId,           // ← always send repId
          month,           // backend can map month -> start/end
          amount: Number(revTarget || 0),
          currency: "GBP",
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to save target");
      setMsg("Target saved");
    } catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function loadScorecard() {
    if (!repId || !month) { setMsg("Please choose a rep and month"); return; }
    setLoading(true);
    setMsg(null);
    try {
      const qs = new URLSearchParams({ repId, month }); // ← always send repId + month
      const r = await fetch(`/api/scorecards/rep?${qs.toString()}`, { cache: "no-store", credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to load scorecard");
      setScore(j as Scorecard);
    } catch (e: any) {
      setMsg(e?.message || "Failed");
      setScore(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Targets &amp; Scorecards</h1>
        <p className="small">Set monthly targets and track attainment and growth.</p>
      </section>

      <section className="card grid" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <div className="field">
            <label>Sales Rep</label>
            <select value={repId} onChange={(e) => setRepId(e.target.value)}>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Month</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <div className="field">
            <label>Revenue Target (GBP)</label>
            <input
              className="input"
              inputMode="decimal"
              value={revTarget}
              onChange={(e) => setRevTarget(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
            <button className="btn" onClick={saveTarget} disabled={saving}>
              {saving ? "Saving…" : "Save Target"}
            </button>
            <button className="primary" onClick={loadScorecard} disabled={loading}>
              {loading ? "Loading…" : "Load Scorecard"}
            </button>
          </div>
        </div>

        {msg && (
          <div className="small" style={{ color: msg.includes("saved") ? "#15803d" : "#b91c1c" }}>
            {msg}
          </div>
        )}
      </section>

      {score && (
        <section className="card grid" style={{ gap: 12 }}>
          <h3>{score.rep.name} — {new Date(score.range.start).toISOString().slice(0, 7)}</h3>

          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="card" style={{ padding: 12 }}>
              <div className="small muted">Revenue</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{money(score.metrics.revenue.actual, score.metrics.revenue.currency)}</div>
              <div className="small">Target: {money(score.metrics.revenue.target, score.metrics.revenue.currency)}</div>
              <div className="small">Attainment: {fmtPct(score.metrics.revenue.attainmentPct)}</div>
              <div className="small">Growth vs prev: {fmtPct(score.metrics.revenue.growthPct)}</div>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <div className="small muted">Orders</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{score.metrics.orders.actual}</div>
              <div className="small">Target: {score.metrics.orders.target}</div>
              <div className="small">Attainment: {fmtPct(score.metrics.orders.attainmentPct)}</div>
              <div className="small">Growth vs prev: {fmtPct(score.metrics.orders.growthPct)}</div>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <div className="small muted">New Customers</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{score.metrics.newCustomers.actual}</div>
              <div className="small">Target: {score.metrics.newCustomers.target}</div>
              <div className="small">Attainment: {fmtPct(score.metrics.newCustomers.attainmentPct)}</div>
            </div>
          </div>

          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>Top Vendors (Revenue)</div>
            {score.vendors.length === 0 ? (
              <div className="small muted">No vendor sales in period.</div>
            ) : (
              <div className="grid" style={{ gap: 6 }}>
                {score.vendors.slice(0, 10).map((v) => (
                  <div key={v.vendor} className="row" style={{ justifyContent: "space-between" }}>
                    <div>{v.vendor}</div>
                    <b>{money(v.revenue, score.metrics.revenue.currency)}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
