"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Request = {
  id: string;
  createdAt: string;
  customerId: string;
  status: "REQUESTED" | "BOOKED" | "CANCELLED" | "COMPLETED";
  salonName: string | null;
  contactName: string | null;
  town: string | null;
  brands: string[];
  educationTypes: string[];
  notes: string | null;
};

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  REQUESTED: { bg: "#fef9c3", fg: "#92400e" },
  BOOKED: { bg: "#dcfce7", fg: "#166534" },
  COMPLETED: { bg: "#e0e7ff", fg: "#3730a3" },
  CANCELLED: { bg: "#fee2e2", fg: "#991b1b" },
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtType(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
}

export default function EducationPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("REQUESTED");
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/education/requests?limit=200", { cache: "no-store" })
      .then(r => r.json())
      .then(j => setRequests(Array.isArray(j) ? j : (j.requests || [])))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function updateStatus(id: string, status: string) {
    setUpdating(id);
    try {
      const r = await fetch("/api/education/requests/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (r.ok) {
        setRequests(prev => prev.map(req => req.id === id ? { ...req, status: status as any } : req));
      }
    } finally {
      setUpdating(null);
    }
  }

  const stats = {
    requested: requests.filter(r => r.status === "REQUESTED").length,
    booked: requests.filter(r => r.status === "BOOKED").length,
    completed: requests.filter(r => r.status === "COMPLETED").length,
    cancelled: requests.filter(r => r.status === "CANCELLED").length,
  };

  const filtered = requests.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (r.salonName || "").toLowerCase().includes(q) ||
             (r.contactName || "").toLowerCase().includes(q) ||
             (r.town || "").toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1 style={{ marginBottom: 2 }}>Education</h1>
            <p className="small muted">Manage education requests, bookings and educators.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/education/requests/new" className="primary">+ New Request</Link>
            <Link href="/education/educators" className="btn">Educators</Link>
          </div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
        {[
          { label: "Requested", value: stats.requested, color: "#92400e", bg: "#fef9c3", filter: "REQUESTED" },
          { label: "Booked", value: stats.booked, color: "#166534", bg: "#dcfce7", filter: "BOOKED" },
          { label: "Completed", value: stats.completed, color: "#3730a3", bg: "#e0e7ff", filter: "COMPLETED" },
          { label: "Cancelled", value: stats.cancelled, color: "#991b1b", bg: "#fee2e2", filter: "CANCELLED" },
          { label: "Total", value: requests.length, color: "var(--text)", bg: "var(--surface-2)", filter: "" },
        ].map(s => (
          <button
            key={s.label}
            onClick={() => setStatusFilter(statusFilter === s.filter ? "" : s.filter)}
            style={{ background: statusFilter === s.filter ? s.bg : "#fff", border: statusFilter === s.filter ? "2px solid " + s.color : "1px solid var(--border)", borderRadius: 12, padding: "14px", textAlign: "center", cursor: "pointer" }}
          >
            <div style={{ fontSize: "1.8rem", fontWeight: 800, color: s.color }}>{s.value}</div>
            <div className="small muted">{s.label}</div>
          </button>
        ))}
      </div>

      <section className="card">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search salon, contact, town..." style={{ flex: "1 1 200px" }} />
          {statusFilter && <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => setStatusFilter("")}>Clear filter</button>}
        </div>
      </section>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{statusFilter || "All"} Requests</h2>
          <span className="small muted">{filtered.length} shown</span>
        </div>

        {loading && <p className="small muted">Loading...</p>}
        {!loading && filtered.length === 0 && <p className="small muted" style={{ textAlign: "center", padding: "20px 0" }}>No requests found.</p>}

        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map(r => {
            const colors = STATUS_COLORS[r.status] || STATUS_COLORS.REQUESTED;
            const isUpdating = updating === r.id;
            return (
              <div key={r.id} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "#fff", overflow: "hidden" }}>
                <div style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{r.salonName || "Unknown Salon"}</div>
                      <div className="small muted">{r.contactName}{r.town ? " - " + r.town : ""} - {fmtDate(r.createdAt)}</div>
                    </div>
                    <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600, background: colors.bg, color: colors.fg, flexShrink: 0 }}>
                      {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    </span>
                  </div>
                  {(r.brands.length > 0 || r.educationTypes.length > 0) && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                      {r.brands.map(b => <span key={b} style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", background: "var(--pink-light)", color: "var(--pink-dark)", fontWeight: 600 }}>{b}</span>)}
                      {r.educationTypes.map(t => <span key={t} style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", background: "#f3f4f6", fontWeight: 600 }}>{fmtType(t)}</span>)}
                    </div>
                  )}
                  {r.notes && <div className="small muted">{r.notes.slice(0, 120)}{r.notes.length > 120 ? "..." : ""}</div>}
                </div>
                <div style={{ display: "flex", gap: 8, padding: "8px 14px", borderTop: "1px solid var(--border)", background: "var(--surface-2)", flexWrap: "wrap" }}>
                  <Link href={"/education/requests/" + r.id} className="btn" style={{ fontSize: "0.78rem", padding: "5px 10px" }}>View</Link>
                  {r.status === "REQUESTED" && (
                    <button className="primary" style={{ fontSize: "0.78rem", padding: "5px 10px" }} disabled={isUpdating} onClick={() => updateStatus(r.id, "BOOKED")}>
                      {isUpdating ? "..." : "Mark Booked"}
                    </button>
                  )}
                  {r.status === "BOOKED" && (
                    <Link
                      href={"/calls/new?customerId=" + (r as any).customerId + "&callType=Education+Visit&educationRequestId=" + r.id}
                      className="primary"
                      style={{ fontSize: "0.78rem", padding: "5px 10px" }}
                    >
                      Log Education Call
                    </Link>
                  )}
                  {r.status === "BOOKED" && (
                    <button className="btn" style={{ fontSize: "0.78rem", padding: "5px 10px" }} disabled={isUpdating} onClick={() => updateStatus(r.id, "REQUESTED")}>
                      {isUpdating ? "..." : "Unbook"}
                    </button>
                  )}
                  {r.status === "COMPLETED" && (
                    <span className="small" style={{ color: "#3730a3", fontWeight: 600, alignSelf: "center" }}>✓ Education completed</span>
                  )}
                  {r.status !== "CANCELLED" && r.status !== "COMPLETED" && (
                    <button className="btn" style={{ fontSize: "0.78rem", padding: "5px 10px", color: "#dc2626" }} disabled={isUpdating} onClick={() => updateStatus(r.id, "CANCELLED")}>
                      {isUpdating ? "..." : "Cancel"}
                    </button>
                  )}
                  {r.status === "CANCELLED" && (
                    <button className="btn" style={{ fontSize: "0.78rem", padding: "5px 10px" }} disabled={isUpdating} onClick={() => updateStatus(r.id, "REQUESTED")}>
                      {isUpdating ? "..." : "Reopen"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
