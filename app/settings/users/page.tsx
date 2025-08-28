// app/settings/users/page.tsx
"use client";

import { useEffect, useState } from "react";

type UserRow = {
  id: string;
  fullName: string;
  email: string;
  phone?: string | null;
  role: "ADMIN" | "MANAGER" | "REP" | "VIEWER";
  isActive: boolean;
  createdAt: string;
};

export default function UsersIndex() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/users", {
        credentials: "include",
        cache: "no-store",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to load users");
      if (!Array.isArray(j)) throw new Error("Unexpected response");
      setRows(j);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load users");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1>User Management</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={load} disabled={loading}>Refresh</button>
          <a className="primary" href="/settings/users/new">Add New User</a>
          <a className="btn" href="/settings">Back to Settings</a>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="small muted">Loading…</div>
        ) : msg ? (
          <div className="form-error">{msg}</div>
        ) : rows.length === 0 ? (
          <div className="small muted">No users yet.</div>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {/* header */}
            <div className="small muted row" style={{ gap: 8 }}>
              <div style={{ flex: "0 0 220px" }}>Name</div>
              <div style={{ flex: "1 1 260px" }}>Email</div>
              <div style={{ flex: "0 0 160px" }}>Phone</div>
              <div style={{ flex: "0 0 120px" }}>Role</div>
              <div style={{ flex: "0 0 90px" }}>Active</div>
              <div style={{ flex: "0 0 200px" }}>Created</div>
            </div>

            {rows.map(u => (
              <div key={u.id} className="row" style={{ gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                <div style={{ flex: "0 0 220px" }}>{u.fullName}</div>
                <div style={{ flex: "1 1 260px" }}>{u.email}</div>
                <div style={{ flex: "0 0 160px" }}>{u.phone || "—"}</div>
                <div style={{ flex: "0 0 120px" }}>{u.role}</div>
                <div style={{ flex: "0 0 90px" }}>{u.isActive ? "Yes" : "No"}</div>
                <div style={{ flex: "0 0 200px" }}>{new Date(u.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
