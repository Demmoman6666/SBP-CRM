"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import RepReviewPanel from "./RepReviewPanel";

type Rep = { id: string; name: string; email: string | null; phone: string | null; territory: string | null; createdAt: string; };
type Stats = { totalCustomers: number; totalCalls: number; pendingFollowUps: number; customersByStage: Record<string, number>; };
type Customer = { id: string; salonName: string; town: string | null; stage: string; updatedAt: string; };
type CallEntry = { id: string; createdAt: string; callType: string | null; outcome: string | null; customerName: string | null; customer: { id: string; salonName: string } | null; durationMinutes: number | null; followUpRequired: boolean; followUpAt: string | null; };
type ProfileData = { rep: Rep; stats: Stats; recentCustomers: Customer[]; recentCalls: CallEntry[]; };

const STAGE_LABEL: Record<string, string> = { LEAD: "Lead", APPOINTMENT_BOOKED: "Appointment", SAMPLING: "Sampling", CUSTOMER: "Customer" };
const STAGE_COLOR: Record<string, string> = { LEAD: "#e0e7ff", APPOINTMENT_BOOKED: "#fef9c3", SAMPLING: "#fce7f3", CUSTOMER: "#dcfce7" };
const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function RepProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/reps/${id}`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("Rep not found"); return r.json(); })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <section className="card"><p className="small">Loading…</p></section>;
  if (error || !data) return <section className="card"><p className="small" style={{ color: "red" }}>{error || "Not found"}</p></section>;

  const { rep, stats, recentCustomers, recentCalls } = data;
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{rep.name}</h1>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {rep.email && <span className="small muted">✉ {rep.email}</span>}
              {rep.phone && <span className="small muted">📞 {rep.phone}</span>}
              {rep.territory && <span className="small muted">📍 {rep.territory}</span>}
              <span className="small muted">Since {fmt(rep.createdAt)}</span>
            </div>
          </div>
          <Link href="/reps" className="btn" style={{ fontSize: "0.85rem" }}>← All Reps</Link>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <div className="card" style={{ textAlign: "center" }}><div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{stats.totalCustomers}</div><div className="small muted">Total Customers</div></div>
        <div className="card" style={{ textAlign: "center" }}><div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{stats.totalCalls}</div><div className="small muted">Total Calls</div></div>
        <div className="card" style={{ textAlign: "center" }}><div style={{ fontSize: "1.8rem", fontWeight: 800, color: stats.pendingFollowUps > 0 ? "#dc2626" : undefined }}>{stats.pendingFollowUps}</div><div className="small muted">Overdue Follow-ups</div></div>
        {Object.entries(stats.customersByStage).map(([stage, count]) => (
          <div key={stage} className="card" style={{ textAlign: "center" }}><div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{count}</div><div className="small muted">{STAGE_LABEL[stage] ?? stage}</div></div>
        ))}
      </div>

      <RepReviewPanel repId={rep.id} repName={rep.name} />

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Jump to Reports</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href={`/reports/rep-scorecard?repId=${rep.id}&from=${firstOfMonth}&to=${todayStr}`} className="btn primary">Rep Scorecard</Link>
          <Link href={`/reports/calls?repId=${rep.id}&from=${firstOfMonth}&to=${todayStr}`} className="btn">Call Report</Link>
          <Link href={`/customers?repId=${rep.id}`} className="btn">All Customers</Link>
          <Link href={`/calls?repId=${rep.id}`} className="btn">All Calls</Link>
        </div>
      </section>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2>Recent Customers</h2>
          <Link href={`/customers?repId=${rep.id}`} className="small" style={{ color: "var(--pink)" }}>View all →</Link>
        </div>
        {recentCustomers.length === 0 ? <p className="small muted">No customers yet.</p> : (
          <div style={{ display: "grid", gap: 8 }}>
            {recentCustomers.map((c) => (
              <Link key={c.id} href={`/customers/${c.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none", color: "inherit", background: "#fff", gap: 8 }}>
                <div><div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{c.salonName}</div>{c.town && <div className="small muted">{c.town}</div>}</div>
                <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "0.75rem", fontWeight: 600, background: STAGE_COLOR[c.stage] ?? "#f3f4f6" }}>{STAGE_LABEL[c.stage] ?? c.stage}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2>Recent Calls (last 30 days)</h2>
          <Link href={`/calls?repId=${rep.id}`} className="small" style={{ color: "var(--pink)" }}>View all →</Link>
        </div>
        {recentCalls.length === 0 ? <p className="small muted">No calls in the last 30 days.</p> : (
          <div style={{ display: "grid", gap: 8 }}>
            {recentCalls.map((c) => (
              <div key={c.id} style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{c.customer?.salonName ?? c.customerName ?? "Unknown"}</div>
                  <div className="small muted">{c.callType ?? "—"} · {c.outcome ?? "—"}{c.durationMinutes ? ` · ${c.durationMinutes}m` : ""}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div className="small muted">{fmt(c.createdAt)}</div>
                  {c.followUpRequired && c.followUpAt && <div className="small" style={{ color: new Date(c.followUpAt) < new Date() ? "#dc2626" : "#ca8a04" }}>Follow-up {fmt(c.followUpAt)}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
