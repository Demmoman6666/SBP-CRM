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
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
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
const isCuid = (s: string) => /^c[a-z0-9]{24,}$/i.test(s);

// Normalise any of the shapes your /api/sales-reps can return
function normaliseReps(payload: any): Rep[] {
  // objects with id/name
  if (Array.isArray(payload) && payload.length && (payload[0]?.id || payload[0]?.name)) {
    return payload
      .map((r: any) => ({ id: String(r.id ?? r.name ?? ""), name: String(r.name ?? r.id ?? "") }))
      .filter(r => r.id && r.name);
  }
  // { ok:true, reps: string[] }
  if (payload?.ok && Array.isArray(payload.reps)) {
    return payload.reps.map((n: any) => ({ id: String(n || ""), name: String(n || "") }));
  }
  // plain string[]
  if (Array.isArray(payload) && (typeof payload[0] === "string")) {
    return payload.map((n: any) => ({ id: String(n || ""), name: String(n || "") }));
  }
  return [];
}

export default function TargetsAndScorecards() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [repId, setRepId] = useState<string>("");   // may be a cuid or a name depending on source
  const [repName, setRepName] = useState<string>("");

  const [month, setMonth] = useState<string>(monthStr());
  const [revTarget, setRevTarget] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [score, setScore] = useState<Scorecard | null>(null);
  const [needsRealId, setNeedsRealId] = useState<boolean>(false);

  // Try to get IDs first (from the SalesRep table), then fall back to the aggregate list
  useEffect(() => {
    (async () => {
      try {
        // Attempt 1: explicit table-only (if the API supports it)
        const r1 = await fetch("/api/sales-reps?tableOnly=1", { cache: "no-store", credentials: "include" });
        const j1 = r1.ok ? await r1.json().catch(() => null) : null;
        const list1 = normaliseReps(j1).filter(r => isCuid(r.id));

        if (list1.length) {
          setReps(list1);
          setRepId(list1[0].id);
          setRepName(list1[0].name);
          setNeedsRealId(false);
          return;
        }

        // Attempt 2: full/aggregate (names only is fine)
        const r2 = await fetch("/api/sales-reps?full=1", { cache: "no-store", credentials: "include" });
        const j2 = await r2.json().catch(() => null);
        const list2 = normaliseReps(j2);

        setReps(list2);
        if (list2.length) {
          setRepId(list2[0].id);     // may be a name string
          setRepName(list2[0].name);
          setNeedsRealId(!isCuid(list2[0].id));
        } else {
          setNeedsRealId(true);
        }
      } catch {
        setReps([]);
        setNeedsRealId(true);
      }
    })();
  }, []);

  // Keep repName in sync with selected option
  useEffect(() => {
    const found = reps.find(r => r.id === repId);
    setRepName(found?.name || "");
    setNeedsRealId(repId ? !isCuid(repId) : false);
  }, [repId, reps]);

  // Load existing target for the month (send both id and name + concrete start/end)
  useEffect(() => {
    if (!repId || !month) return;
    (async () => {
      setMsg(null);
      try {
        const { start, end } = monthRange(month);
        const qs = new URLSearchParams({
          scope: "REP",
          metric: "REVENUE",
          repId,                   // preferred
          repName: repName || repId,
          staff: repName || repId, // some APIs use 'staff'
          start,
          end,
        });
        const r = await fetch(`/api/targets?${qs.toString()}`, { cache: "no-store", credentials: "include" });
        if (!r.ok) {
          // If the API insists on a DB id, keep the inline hint visible
          setNeedsRealId(!isCuid(repId));
          return;
        }
        const j = await r.json();
        const t = Array.isArray(j?.targets) ? j.targets[0] : null;
        setRevTarget(t ? String(t.amount) : "");
      } catch {
        // ignore; user can still set target
      }
    })();
  }, [repId, repName, month]);

  async function saveTarget() {
    if (!repId || !month) { setMsg("Choose a rep and month"); return; }
    setSaving(true);
    setMsg(null);
    try {
      const { start, end } = monthRange(month);
      const body: any = {
        scope: "REP",
        metric: "REVENUE",
        month,                    // convenience for servers that accept month
        start, end,               // and explicit dates for those that require them
        repId,
        repName: repName || repId,
        staff: repName || repId,
        amount: Number(revTarget || 0),
        currency: "GBP",
      };
      const res = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!isCuid(repId)) setNeedsRealId(true);
        throw new Error(j?.error || "Failed to save target");
      }
      setMsg("Target saved");
    } catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function loadScorecard() {
    if (!repId || !month) { setMsg("Choose a rep and month"); return; }
    setLoading(true);
    setMsg(null);
    try {
      const qs = new URLSearchParams({
        repId,
        repName: repName || repId,
        staff: repName || repId,
        month,
      });
      const r = await fetch(`/api/scorecards/rep?${qs.toString()}`, { cache: "no-store", credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (!isCuid(repId)) setNeedsRealId(true);
        throw new Error(j?.error || "Failed to load scorecard");
      }
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
            <select
              value={repId}
              onChange={(e) => setRepId(e.target.value)}
            >
              {reps.map((r) => (
                <option key={`${r.id}-${r.name}`} value={r.id}>{r.name}</option>
              ))}
            </select>
            {needsRealId && (
              <div className="small" style={{ color: "#b91c1c", marginTop: 6 }}>
                Rep not found in the SalesRep table. Actions will also send the rep name, but if your API requires a DB id,
                add this rep in <b>Settings → Sales Reps</b>.
              </div>
            )}
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
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {money(score.metrics.revenue.actual, score.metrics.revenue.currency)}
              </div>
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
