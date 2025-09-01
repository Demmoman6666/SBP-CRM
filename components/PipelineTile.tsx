// components/PipelineTile.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Stage = "LEAD" | "APPOINTMENT_BOOKED" | "SAMPLING" | "CUSTOMER";
type PipelineRow = {
  id: string;
  salonName: string;
  customerName: string | null;
  salesRep: string | null;
  stage: Stage | null;
  createdAt: string; // ISO
};

type PipelinePayload = {
  counts: {
    LEAD: number;
    APPOINTMENT_BOOKED: number;
    SAMPLING: number;
    CUSTOMER: number;
    total: number;
  };
  items: PipelineRow[];
};

type SalesRepLite = { id: string; name: string };

const STAGE_LABEL: Record<Stage, string> = {
  LEAD: "Lead",
  APPOINTMENT_BOOKED: "Appointment booked",
  SAMPLING: "Sampling",
  CUSTOMER: "Customer",
};

const STAGE_ORDER: Stage[] = ["LEAD", "APPOINTMENT_BOOKED", "SAMPLING", "CUSTOMER"];

function fmtDate(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())} ${pad(
    x.getHours()
  )}:${pad(x.getMinutes())}`;
}

export default function PipelineTile() {
  const [reps, setReps] = useState<SalesRepLite[]>([]);
  const [rep, setRep] = useState<string>(""); // filter value (rep name)
  const [data, setData] = useState<PipelinePayload | null>(null);
  const [loading, setLoading] = useState(false);

  // load reps for dropdown
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sales-reps", { cache: "no-store" });
        if (r.ok) setReps(await r.json());
      } catch {
        setReps([]);
      }
    })();
  }, []);

  // load pipeline whenever rep filter changes
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (rep) qs.set("rep", rep);
        const r = await fetch(`/api/pipeline?${qs.toString()}`, { cache: "no-store" });
        if (r.ok) setData(await r.json());
        else setData(null);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [rep]);

  const rows = useMemo(() => {
    if (!data) return [];
    // Optional: sort by stage order first, then createdAt desc
    const copy = [...data.items];
    copy.sort((a, b) => {
      const ai = STAGE_ORDER.indexOf((a.stage || "LEAD") as Stage);
      const bi = STAGE_ORDER.indexOf((b.stage || "LEAD") as Stage);
      if (ai !== bi) return ai - bi;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return copy;
  }, [data]);

  const counts = data?.counts;

  return (
    <section className="card" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>Pipeline</h2>
          <p className="small" style={{ marginTop: 4 }}>
            Track customers by stage{rep ? ` — filtered by ${rep}` : ""}.
          </p>
        </div>

        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <label className="small">Sales Rep</label>
          <select
            value={rep}
            onChange={(e) => setRep(e.target.value)}
            style={{ minWidth: 180 }}
          >
            <option value="">All reps</option>
            {reps.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stage counts */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {STAGE_ORDER.map((s) => (
          <span key={s} className="badge">
            {STAGE_LABEL[s]}
            <span className="small muted"> {counts ? counts[s] : 0}</span>
          </span>
        ))}
        <span className="badge" style={{ background: "#f3f4f6", color: "#111827" }}>
          Total
          <span className="small muted"> {counts?.total ?? 0}</span>
        </span>
      </div>

      {/* Table */}
      <div style={{ marginTop: 12 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Customer</th>
              <th style={{ width: 220 }}>Contact</th>
              <th style={{ width: 160 }}>Stage</th>
              <th style={{ width: 180 }}>Sales Rep</th>
              <th style={{ width: 170 }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5}>
                  <div className="small muted">Loading…</div>
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="small muted">No customers found.</div>
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/customers/${c.id}`} className="link">
                      {c.salonName}
                    </Link>
                  </td>
                  <td className="small">{c.customerName || "—"}</td>
                  <td className="small">{c.stage ? STAGE_LABEL[c.stage] : "Lead"}</td>
                  <td className="small">{c.salesRep || "—"}</td>
                  <td className="small">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
