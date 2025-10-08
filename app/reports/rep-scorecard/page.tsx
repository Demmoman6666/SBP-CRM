// app/reports/rep-scorecard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type ScoreCard = {
  ok: boolean;
  range: { from: string; to: string };
  rep: { id: string | null; name: string | null };
  currency: string;
  section1: { salesEx: number; profit: number; marginPct: number };
  section2: {
    totalCalls: number;
    coldCalls: number;
    bookedCalls: number;
    bookedDemos: number;
    avgTimePerCallMins: number;
    avgCallsPerDay: number;
    activeDays: number;
  };
  section3: { totalCustomers: number; newCustomers: number };
};

type Rep = { id: string; name: string };

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function ymdLocal(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function addDaysLocal(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function mondayOfWeek(d: Date) { const dow = d.getDay(); const delta = dow === 0 ? -6 : 1 - dow; return addDaysLocal(d, delta); }
function firstOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastMonthFirst(d: Date) { return new Date(d.getFullYear(), d.getMonth()-1, 1); }
function lastMonthLast(d: Date) { const firstThis = new Date(d.getFullYear(), d.getMonth(), 1); return addDaysLocal(firstThis, -1); }
function ytdFirst(d: Date) { return new Date(d.getFullYear(), 0, 1); }

function Chip(props: { onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button
      className="btn"
      onClick={props.onClick}
      title={props.title}
      disabled={props.disabled}
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "#fff",
        opacity: props.disabled ? 0.6 : 1,
      }}
    >
      {props.children}
    </button>
  );
}

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

export default function RepScorecardPage() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState<string>(ymdLocal(today));
  const [to, setTo] = useState<string>(ymdLocal(today));

  const [reps, setReps] = useState<Rep[]>([]);
  const [repId, setRepId] = useState<string>("");
  const [repName, setRepName] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ScoreCard | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sales-reps", { cache: "no-store", credentials: "include" });
        const j = await r.json().catch(() => null);
        const list = normalizeRepsResponse(j);
        setReps(list);
      } catch {
        setReps([]);
      }
    })();
  }, []);

  async function load(params?: { from?: string; to?: string; repId?: string; repName?: string }) {
    const f = params?.from ?? from;
    const t = params?.to ?? to;
    const id = params?.repId ?? repId;
    const name = params?.repName ?? repName;

    const qs = new URLSearchParams({ from: f, to: t });
    if (id) qs.set("repId", id);
    if (!id && name) qs.set("rep", name);

    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/reports/rep-scorecard?${qs.toString()}`, {
        cache: "no-store",
        credentials: "include",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to load score card");
      setData(j as ScoreCard);
    } catch (e: any) {
      setErr(e?.message || "Failed to load score card");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickRange(kind: string) {
    const now = new Date();
    let f = from, t = to;

    if (kind === "today") { f = ymdLocal(now); t = ymdLocal(now); }
    else if (kind === "yesterday") { const y = addDaysLocal(now, -1); f = ymdLocal(y); t = ymdLocal(y); }
    else if (kind === "wtd") { const start = mondayOfWeek(now); f = ymdLocal(start); t = ymdLocal(now); }
    else if (kind === "lweek") { const thisMon = mondayOfWeek(now); f = ymdLocal(addDaysLocal(thisMon, -7)); t = ymdLocal(addDaysLocal(thisMon, -1)); }
    else if (kind === "mtd") { f = ymdLocal(firstOfMonth(now)); t = ymdLocal(now); }
    else if (kind === "lmonth") { f = ymdLocal(lastMonthFirst(now)); t = ymdLocal(lastMonthLast(now)); }
    else if (kind === "ytd") { f = ymdLocal(ytdFirst(now)); t = ymdLocal(now); }
    else if (kind === "custom") {
      const input = prompt("Enter custom range as YYYY-MM-DD to YYYY-MM-DD", `${from} to ${to}`);
      if (!input) return;
      const m = /^\s*(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\s*$/i.exec(input);
      if (!m) { alert("Invalid format. Example: 2025-08-01 to 2025-08-24"); return; }
      f = m[1]; t = m[2];
    }

    setFrom(f); setTo(t);
    load({ from: f, to: t });
  }

  const lastUpdated = data ? new Date().toLocaleString() : "—";
  const ccy = data?.currency || "GBP";

  function money(n?: number) {
    if (typeof n !== "number" || isNaN(n)) return "—";
    return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy }).format(n);
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <h1 style={{ margin: 0 }}>Sales Rep Score Card</h1>
          <div className="small muted">Last updated: <b>{lastUpdated}</b></div>
        </div>

        {/* Filters */}
        <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <label className="small muted">Rep</label>
            <select
              value={repId || ""}
              onChange={(e) => {
                const id = e.target.value;
                setRepId(id);
                // when selecting by id, clear name-based filter
                setRepName("");
                load({ repId: id, repName: "" });
              }}
            >
              <option value="">— Select a Sales Rep —</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            {!repId && (
              <>
                <span className="small muted">or name</span>
                <input
                  placeholder="Type rep name…"
                  value={repName}
                  onChange={(e) => { setRepName(e.target.value); }}
                  onBlur={() => load({ repName })}
                />
              </>
            )}
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Chip onClick={() => pickRange("today")}>Today</Chip>
            <Chip onClick={() => pickRange("yesterday")}>Yesterday</Chip>
            <Chip onClick={() => pickRange("wtd")}>Week to date</Chip>
            <Chip onClick={() => pickRange("lweek")}>Last week</Chip>
            <Chip onClick={() => pickRange("mtd")}>Month to date</Chip>
            <Chip onClick={() => pickRange("lmonth")}>Last month</Chip>
            <Chip onClick={() => pickRange("ytd")}>Year to date</Chip>
            <Chip onClick={() => pickRange("custom")}>Custom…</Chip>
          </div>
        </div>

        <div className="small muted">
          Range: <b>{from}</b> to <b>{to}</b>
          {data?.rep?.name ? <> • Rep: <b>{data.rep.name}</b></> : null}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      {err && (
        <div className="card" style={{ borderColor: "#fca5a5" }}>
          <div className="small" style={{ color: "#b91c1c" }}>{err}</div>
        </div>
      )}

      {/* ---------------- Section 1 ---------------- */}
      <section className="grid grid-3" style={{ gap: 12 }}>
        <div className="card">
          <div className="small muted">Sales (ex VAT)</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {data ? money(data.section1.salesEx) : "—"}
          </div>
        </div>
        <div className="card">
          <div className="small muted">Margin %</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {data ? `${data.section1.marginPct.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div className="card">
          <div className="small muted">Profit</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {data ? money(data.section1.profit) : "—"}
          </div>
        </div>
      </section>

      {/* ---------------- Section 2 ---------------- */}
      <section className="grid" style={{ gap: 12 }}>
        <div className="grid grid-3">
          <div className="card">
            <div className="small muted">Total Calls</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{data ? data.section2.totalCalls : "—"}</div>
          </div>
          <div className="card">
            <div className="small muted">Cold Calls</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{data ? data.section2.coldCalls : "—"}</div>
          </div>
          <div className="card">
            <div className="small muted">Booked Calls</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{data ? data.section2.bookedCalls : "—"}</div>
          </div>
        </div>

        <div className="grid grid-3">
          <div className="card">
            <div className="small muted">Booked Demos</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{data ? data.section2.bookedDemos : "—"}</div>
          </div>
          <div className="card">
            <div className="small muted">Average Time Per Call (mins)</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {data ? data.section2.avgTimePerCallMins.toFixed(1) : "—"}
            </div>
          </div>
          <div className="card">
            <div className="small muted">Average Calls per Day</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {data ? data.section2.avgCallsPerDay.toFixed(2) : "—"}
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              (Total Calls ÷ Active Days)
            </div>
          </div>
        </div>

        <div className="card">
          <div className="small muted">Days Active</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data ? data.section2.activeDays : "—"}</div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Number of days with at least one logged call
          </div>
        </div>
      </section>

      {/* ---------------- Section 3 ---------------- */}
      <section className="grid grid-2" style={{ gap: 12 }}>
        <div className="card">
          <div className="small muted">Total Customers</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{data ? data.section3.totalCustomers : "—"}</div>
        </div>
        <div className="card">
          <div className="small muted">New Customers</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{data ? data.section3.newCustomers : "—"}</div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Created within the selected range
          </div>
        </div>
      </section>
    </div>
  );
}
