// components/PipelineTile.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Stage = "LEAD" | "APPOINTMENT_BOOKED" | "SAMPLING" | "CUSTOMER";
type Row = {
  id: string;
  salonName: string | null;
  customerName: string | null;
  salesRep: string | null;
  stage: Stage | null;
  updatedAt: string;
};

const LABEL: Record<Stage, string> = {
  LEAD: "Lead",
  APPOINTMENT_BOOKED: "Appointment booked",
  SAMPLING: "Sampling",
  CUSTOMER: "Customer",
};

const STAGES: (Stage | "ALL")[] = ["ALL", "LEAD", "APPOINTMENT_BOOKED", "SAMPLING", "CUSTOMER"];

function pad(n: number) { return String(n).padStart(2, "0"); }
function fmt(d: string) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export default function PipelineTile() {
  const [stage, setStage] = useState<Stage | "ALL">("ALL");
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Record<Stage, number>>({
    LEAD: 0, APPOINTMENT_BOOKED: 0, SAMPLING: 0, CUSTOMER: 0,
  });
  const [loading, setLoading] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (stage !== "ALL") p.set("stage", stage);
    p.set("limit", "100");
    return p.toString();
  }, [stage]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/pipeline?${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setRows(j.customers || []);
      setSummary(j.summary || summary);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [qs]);

  return (
    <section className="card" style={{ display: "grid", gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Pipeline</h3>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {STAGES.map(s => {
            const count =
              s === "ALL"
                ? Object.values(summary).reduce((a, b) => a + b, 0)
                : summary[s] || 0;
            const label = s === "ALL" ? "All" : LABEL[s];
            const active = stage === s;
            return (
              <button
                key={s}
                type="button"
                className="badge"
                onClick={() => setStage(s)}
                style={{
                  borderRadius: 999,
                  cursor: "pointer",
                  background: active ? "var(--accent)" : undefined,
                  color: active ? "#fff" : undefined,
                }}
              >
                {label} <span className="small muted"> {count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="table" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>Customer</th>
              <th style={{ width: 220 }}>Sales Rep</th>
              <th style={{ width: 220 }}>Stage</th>
              <th style={{ width: 180 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="small">{r.salonName || r.customerName || "—"}</td>
                <td className="small">{r.salesRep || "—"}</td>
                <td className="small">{r.stage ? LABEL[r.stage] : "—"}</td>
                <td className="small">{fmt(r.updatedAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <div className="small muted" style={{ padding: 8 }}>
                    {loading ? "Loading…" : "No customers for this filter."}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
