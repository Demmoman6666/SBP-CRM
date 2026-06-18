"use client";

import { useEffect, useState } from "react";

type Stocked = { id: string; name: string; visibleInCallLog: boolean; visibleInReports: boolean };

export default function StockedBrandVisibility() {
  const [rows, setRows] = useState<Stocked[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/brand-visibility?type=stocked", { credentials: "include", cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to load");
      if (!Array.isArray(j?.rows)) throw new Error("Unexpected response");
      setRows(j.rows);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load stocked brands");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(id: string, field: "visibleInCallLog" | "visibleInReports", next: boolean) {
    setSaving(`${id}-${field}`);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/brand-visibility?type=stocked", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, [field]: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Update failed");
      setRows((r) => r.map((x) => (x.id === id ? { ...x, [field]: next } : x)));
    } catch (e: any) {
      setMsg(e?.message || "Update failed");
    } finally {
      setSaving(null);
    }
  }

  async function toggleAllReports(next: boolean) {
    setMsg(null);
    for (const row of rows) {
      if (row.visibleInReports !== next) {
        await toggle(row.id, "visibleInReports", next);
      }
    }
    setMsg(next ? "All brands shown in reports." : "All brands hidden from reports.");
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h1>Brand Management</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={load} disabled={loading}>Refresh</button>
          <a href="/settings" className="btn">Back to Settings</a>
        </div>
      </div>

      <div className="card">
        <p className="small muted" style={{ marginBottom: 16 }}>
          Control which brands appear in the <b>Call Log</b> and in <b>Reports</b> (gap analysis, vendor scorecard etc).
          Only tick the brands you currently carry.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => toggleAllReports(true)}>Show all in Reports</button>
          <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => toggleAllReports(false)}>Hide all from Reports</button>
        </div>

        {loading ? (
          <div className="small muted">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="small muted">No stocked brands found.</div>
        ) : (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px", gap: 8, padding: "8px 0", borderBottom: "2px solid var(--border)", marginBottom: 8 }}>
              <div className="small" style={{ fontWeight: 700 }}>Brand</div>
              <div className="small" style={{ fontWeight: 700, textAlign: "center" }}>Call Log</div>
              <div className="small" style={{ fontWeight: 700, textAlign: "center" }}>Reports</div>
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              {rows.map((b) => (
                <div key={b.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px", gap: 8, padding: "10px 0", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                  <span style={{ fontWeight: b.visibleInReports ? 600 : 400 }}>{b.name}</span>
                  <div style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={!!b.visibleInCallLog}
                      onChange={(e) => toggle(b.id, "visibleInCallLog", e.currentTarget.checked)}
                      disabled={saving === `${b.id}-visibleInCallLog`}
                    />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={!!b.visibleInReports}
                      onChange={(e) => toggle(b.id, "visibleInReports", e.currentTarget.checked)}
                      disabled={saving === `${b.id}-visibleInReports`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {msg && <div className="small muted" style={{ marginTop: 12 }}>{msg}</div>}
      </div>
    </div>
  );
}
