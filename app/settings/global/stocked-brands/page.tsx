"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = { id: string; name: string; visible: boolean };

export default function ToggleStockedBrandsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/brand-visibility?type=STOCKED", { cache: "no-store" })
      .then(r => r.json()).then(setRows).catch(() => setRows([]));
  }, []);

  async function setOne(id: string, visible: boolean) {
    setErr(null);
    setSaving(true);
    setRows(prev => prev.map(r => r.id === id ? { ...r, visible } : r));
    try {
      const r = await fetch("/api/settings/brand-visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "STOCKED", brandId: id, visible }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Failed to save");
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to save");
      // reload to resync
      const fresh = await fetch("/api/settings/brand-visibility?type=STOCKED", { cache: "no-store" }).then(r => r.json()).catch(() => []);
      setRows(fresh);
    } finally {
      setSaving(false);
    }
  }

  function all(on: boolean) {
    rows.forEach(r => setOne(r.id, on));
  }

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1>Toggle Stocked Brands</h1>
        <Link className="btn" href="/settings">← Back to Settings</Link>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8, justifyContent: "space-between", alignItems: "center" }}>
          <div className="small muted">Check the brands you want to appear in “Log Call”.</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => all(true)} disabled={saving}>Select all</button>
            <button className="btn" onClick={() => all(false)} disabled={saving}>Clear all</button>
          </div>
        </div>

        <div className="grid" style={{ gap: 8, marginTop: 10 }}>
          {rows.map(r => (
            <label key={r.id} className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={r.visible}
                onChange={(e) => setOne(r.id, e.target.checked)}
              />
              {r.name}
            </label>
          ))}
          {rows.length === 0 && <div className="small muted">No brands found.</div>}
        </div>

        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          {saving && <span className="small" style={{ color: "#0ea5e9" }}>Saving…</span>}
          {err && <span className="small" style={{ color: "#b91c1c" }}>{err}</span>}
        </div>
      </div>
    </div>
  );
}
