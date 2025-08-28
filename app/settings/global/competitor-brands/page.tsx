// app/settings/global/competitor-brands/page.tsx
"use client";

import { useEffect, useState } from "react";

type Brand = { id: string; name: string; visibleInCallLog: boolean };

export default function CompetitorBrandVisibility() {
  const [rows, setRows] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [who, setWho] = useState<any>(null);

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      // (optional) show who is signed in
      const me = await fetch("/api/me", { credentials: "include", cache: "no-store" });
      setWho(me.ok ? await me.json().catch(() => null) : null);

      const res = await fetch(
        "/api/settings/brand-visibility?type=competitor",
        { credentials: "include", cache: "no-store" }
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to load brands");
      if (!Array.isArray(j?.rows)) throw new Error("Unexpected response");
      setRows(j.rows);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load brands");
      setRows([]);
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
      const res = await fetch(
        "/api/settings/brand-visibility?type=competitor",
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, visible: next }),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Update failed");

      // Optimistic update
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
        <h1>Toggle Competitor Brands</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={load} disabled={loading}>Refresh</button>
          <a href="/settings" className="btn">Back to Settings</a>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="small muted">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="small muted">No competitor brands found.</div>
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
          Checked brands will appear as checkboxes on the “Log Call” page under “Competitor Brands”.
        </p>

        {who && (
          <p className="small muted" style={{ marginTop: 8 }}>
            Signed in as: {who?.fullName ?? who?.email ?? "(unknown)"} ({who?.role})
          </p>
        )}
      </div>
    </div>
  );
}
