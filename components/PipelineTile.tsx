// components/PipelineTile.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Stage = "LEAD" | "APPOINTMENT_BOOKED" | "SAMPLING" | "CUSTOMER";

type Row = {
  id: string;
  salonName: string;
  customerName: string | null;
  salesRep: string | null;
  stage: Stage;
  createdAt: string; // ISO
};

type Counts = {
  LEAD: number;
  APPOINTMENT_BOOKED: number;
  SAMPLING: number;
  CUSTOMER: number;
  total: number;
};

type ApiResponse = { counts: Counts; items: Row[] };

const STAGE_LABELS: Record<Stage, string> = {
  LEAD: "Lead",
  APPOINTMENT_BOOKED: "Appointment booked",
  SAMPLING: "Sampling",
  CUSTOMER: "Customer",
};

export default function PipelineTile() {
  const [rep, setRep] = useState<string>("");
  const [stage, setStage] = useState<Stage | "">(""); // "" = Total (no filter)
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Fetch pipeline when rep or stage changes
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("take", "200");
        if (rep) params.set("rep", rep);
        if (stage) params.set("stage", stage);
        const res = await fetch(`/api/pipeline?${params.toString()}`, {
          credentials: "include",
        });
        const json: ApiResponse = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [rep, stage]);

  // Build Sales Rep options from current rows (simple + robust)
  const reps = useMemo(() => {
    const set = new Set<string>();
    (data?.items || []).forEach((r) => {
      if (r.salesRep) set.add(r.salesRep);
    });
    return Array.from(set).sort();
  }, [data]);

  const rows = data?.items || [];

  const Pill = ({
    value,
    count,
    children,
  }: {
    value: Stage | ""; // "" means Total
    count: number;
    children: React.ReactNode;
  }) => {
    const isActive = stage === value || (!stage && value === "");
    return (
      <button
        type="button"
        onClick={() => setStage(value)}
        className="small"
        style={{
          border: "1px solid var(--border)",
          padding: "2px 8px",
          borderRadius: 999,
          background: isActive ? "#111" : "#fff",
          color: isActive ? "#fff" : "inherit",
          cursor: "pointer",
        }}
        aria-pressed={isActive}
      >
        {children}{" "}
        <span
          style={{
            display: "inline-block",
            minWidth: 18,
            textAlign: "center",
            marginLeft: 6,
            padding: "0 6px",
            borderRadius: 999,
            background: isActive ? "rgba(255,255,255,0.2)" : "#f3f4f6",
          }}
        >
          {count}
        </span>
      </button>
    );
  };

  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div>
          <h3 style={{ marginBottom: 8 }}>Pipeline</h3>
          <div className="small muted">Track customers by stage.</div>
        </div>

        {/* Sales Rep dropdown (kept) */}
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="small muted">Sales Rep</span>
          <select
            value={rep}
            onChange={(e) => setRep(e.target.value)}
            className="input"
            style={{ height: 30 }}
          >
            <option value="">All reps</option>
            {reps.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stage pills (NOW CLICKABLE) */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Pill value="LEAD" count={data?.counts?.LEAD ?? 0}>
          {STAGE_LABELS.LEAD}
        </Pill>
        <Pill value="APPOINTMENT_BOOKED" count={data?.counts?.APPOINTMENT_BOOKED ?? 0}>
          {STAGE_LABELS.APPOINTMENT_BOOKED}
        </Pill>
        <Pill value="SAMPLING" count={data?.counts?.SAMPLING ?? 0}>
          {STAGE_LABELS.SAMPLING}
        </Pill>
        <Pill value="CUSTOMER" count={data?.counts?.CUSTOMER ?? 0}>
          {STAGE_LABELS.CUSTOMER}
        </Pill>
        <Pill value="" count={data?.counts?.total ?? 0}>Total</Pill>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ width: 280 }}>Customer</th>
              <th style={{ width: 220 }}>Contact</th>
              <th style={{ width: 140 }}>Stage</th>
              <th style={{ width: 160 }}>Sales Rep</th>
              <th style={{ width: 120 }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="small muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="small muted">
                  No customers found.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/customers/${r.id}`} className="link">
                      {r.salonName}
                    </Link>
                  </td>
                  <td className="small">{r.customerName || "—"}</td>
                  <td className="small">{STAGE_LABELS[r.stage]}</td>
                  <td className="small">{r.salesRep || "—"}</td>
                  <td className="small">
                    {new Date(r.createdAt).toLocaleDateString("en-GB")}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
