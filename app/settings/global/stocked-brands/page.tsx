"use client";

import { useEffect, useState } from "react";

type Stocked = { id: string; name: string; visibleInCallLog: boolean };

export default function StockedBrandVisibility() {
  const [rows, setRows] = useState<Stocked[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/stocked-brands", { credentials: "include", cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to load stocked brands");
      if (!Array.isArray(j)) throw new Error("Unexpected response");
      setRows(j);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load stocked brands");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle(id: string, next: boolean) {
    setSaving(id);
    setMsg(null);
    try {
      const res = await fetch("/api/stocked-brands", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, visible: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Update failed");
      setRows((r) => r.map((x) => (x.id === id ? { ...x, visibleInCallLog: next } : x)));
    } catch (e: any) {
      setMsg(e?.message || "Update failed");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1>Toggle Stocked Brands</h1>
        <a href="/settings" className="btn">Back to Settings</a>
      </div>

      <div className="card">
        {loading ? (
          <div className="small muted">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="small muted">No stocked brands found.</div>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {rows.map((b) => (
              <label key={b.id} className="row" style={{ gap: 10, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={!!b.visibleInCallLog}
                  onChange={(e) => toggle(b.id, e.currentTarget.checked)}
                  disabled={saving === b.id}
                />
                <span>{b.name}</span>
              </label>
            ))}
          </div>
        )}

        {msg && <div className="form-error" style={{ marginTop: 10 }}>{msg}</div>}
        <p className="small muted" style={{ marginTop: 8 }}>
          Checked brands will appear as checkboxes on the “Log Call” page under “Stocked Brands”.
        </p>
      </div>
    </div>
  );
}
