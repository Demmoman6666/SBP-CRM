// app/reports/targets/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

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

/** /api/sales-reps may return:
 *  - [{ id, name }, ...]  OR
 *  - { ok: true, reps: string[] }
 */
function normalizeRepsResponse(j: any): Rep[] {
  if (Array.isArray(j)) {
    return j
      .map((r: any) =>
        typeof r === "string"
          ? { id: r, name: r }
          : { id: String(r?.id ?? r?.name ?? ""), name: String(r?.name ?? r?.id ?? "") }
      )
      .filter((r) => !!r.name);
  }
  if (j?.ok && Array.isArray(j.reps)) {
    return j.reps
      .map((name: any) => String(name || ""))
      .filter(Boolean)
      .map((name: string) => ({ id: name, name }));
  }
  return [];
}

function findRepByKey(key: string, reps: Rep[]): Rep | null {
  if (!key) return null;
  return reps.find(r => r.id === key) || reps.find(r => r.name === key) || null;
}

/** Heuristic: only treat as a real DB id if it looks like a Prisma CUID */
function looksLikeCuid(s: string | undefined): boolean {
  return !!s && /^c[a-z0-9]{24,}$/i.test(s);
}

export default function TargetsAndScorecards() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [repKey, setRepKey] = useState<string>("");
  const [month, setMonth] = useState<string>(monthStr());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // targets (revenue)
  const [revTarget, setRevTarget] = useState<string>("");

  const [score, setScore] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(false);

  // Load reps
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sales-reps", { cache: "no-store", credentials: "include" });
        const j = await r.json().catch(() => null);
        const list = normalizeRepsResponse(j);
        setReps(list);
        if (!repKey && list.length) setRepKey(list[0].id);
      } catch {
        setReps([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load existing target for the chosen month
  useEffect(() => {
    const sel = findRepByKey(repKey, reps);
    if (!sel || !month) return;

    (async () => {
      setMsg(null);
      try {
        const q = new URLSearchParams({ scope: "REP", metric: "REVENUE", start: month, end: month });
        // ✅ Always send the name (repName/staff). Only send repId if it looks valid.
        if (looksLikeCuid(sel.id)) q.set("repId", sel.id);
        if (sel.name) {
          q.set("repName", sel.name);
          q.set("staff", sel.name);
        }

        const r = await fetch(`/api/targets?${q.toString()}`, { cache: "no-store", credentials: "include" });
        const j = await r.json();
        const t = Array.isArray(j?.targets) ? j.targets[0] : null;
        setRevTarget(t ? String(t.amount) : "");
      } catch {}
    })();
  }, [repKey, month, reps]);

  async function saveTarget() {
    const sel = findRepByKey(repKey, reps);
    if (!sel || !month) return;
    setSaving(true);
    setMsg(null);
    try {
      const payload: any = {
        scope: "REP",
        metric: "REVENUE",
        month, // server maps month -> periodStart/End
        amount: Number(revTarget || 0),
        currency: "GBP",
      };
      // ✅ Include name; include repId only if it’s a real id
      if (looksLikeCuid(sel.id)) payload.repId = sel.id;
      if (sel.name) {
        payload.repName = sel.name;
        payload.staff = sel.name;
      }

      const res = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
    const sel = findRepByKey(repKey, reps);
    if (!sel || !month) return;
    setLoading(true);
    setMsg(null);
    try {
      const q = new URLSearchParams({ month });
      // ✅ Prefer name matching; only include repId when it’s a real id
      if (looksLikeCuid(sel.id)) q.set("repId", sel.id);
      if (sel.name) {
        q.set("repName", sel.name);
        q.set("staff", sel.name);
      }

      const r = await fetch(`/api/scorecards/rep?${q.toString()}`, { cache: "no-store", credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to load scorecard");
      setScore(j);
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
            <select value={repKey} onChange={(e) => setRepKey(e.target.value)}>
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
