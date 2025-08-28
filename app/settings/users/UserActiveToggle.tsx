// app/settings/users/UserActiveToggle.tsx
"use client";

import { useState } from "react";

export default function ActiveToggle({ id, initial }: { id: string; initial: boolean }) {
  const [active, setActive] = useState<boolean>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function flip() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !active }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed");
      setActive(!active);
    } catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="row" style={{ gap: 8, alignItems: "center" }}>
      <button
        type="button"
        onClick={flip}
        disabled={saving}
        className={active ? "btn" : "btn"}
        style={{
          background: active ? "#fee2e2" : "#dcfce7",
          border: `1px solid ${active ? "#fca5a5" : "#86efac"}`,
          color: active ? "#991b1b" : "#166534",
        }}
        title={active ? "Deactivate" : "Reactivate"}
      >
        {saving ? "Saving…" : active ? "Deactivate" : "Reactivate"}
      </button>
      {msg && <span className="small" style={{ color: "#b91c1c" }}>{msg}</span>}
    </div>
  );
}
