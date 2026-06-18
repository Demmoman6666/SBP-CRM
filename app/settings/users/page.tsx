"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Role = "ADMIN" | "MANAGER" | "REP" | "VIEWER";
type UserRow = {
  id: string;
  fullName: string;
  email: string;
  phone?: string | null;
  role: Role;
  isActive: boolean;
  createdAt: string;
};

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

export default function UsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [who, setWho] = useState<any>(null);

  async function load() {
    setLoading(true);
    setMsg(null);
    setRows([]);
    try {
      const meRes = await fetch("/api/me?ts=" + Date.now(), { credentials: "include", cache: "no-store" });
      const me = meRes.ok ? await safeJson(meRes) : null;
      setWho(me);
      if (!meRes.ok || !me) { setMsg("Unauthorized — please sign in."); return; }
      if (me.role !== "ADMIN") { setMsg("Forbidden — admin access required."); return; }

      const apiUrl = `${window.location.origin}/api/users?ts=${Date.now()}`;
      const res = await fetch(apiUrl, { credentials: "include", cache: "no-store" });
      const body = await safeJson(res);
      if (!res.ok) throw new Error((body as any)?.error || `HTTP ${res.status}`);

      const list: any[] = Array.isArray((body as any)?.users) ? (body as any).users : Array.isArray(body) ? (body as any) : [];
      setRows(list.map((u: any) => ({
        id: String(u.id),
        fullName: String(u.fullName ?? ""),
        email: String(u.email ?? ""),
        phone: u.phone ?? null,
        role: String(u.role) as Role,
        isActive: Boolean(u.isActive),
        createdAt: (u.createdAt && new Date(u.createdAt).toISOString()) || new Date().toISOString(),
      })));
    } catch (e: any) {
      setMsg(e?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  async function deleteUser(u: UserRow) {
    if (u.id === who?.id) { setMsg("You cannot delete your own account."); return; }
    if (!confirm(`Delete "${u.fullName || u.email}"? This cannot be undone.`)) return;
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE", credentials: "include" });
      const j = await safeJson(r);
      if (!r.ok) throw new Error((j as any)?.error || "Delete failed");
      setMsg(`${u.fullName || u.email} deleted.`);
      await load();
    } catch (e: any) {
      setMsg(e?.message || "Delete failed");
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1>User Management</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={load}>Refresh</button>
          <Link href="/settings/users/new" className="primary">Add New User</Link>
          <Link href="/settings" className="btn">Back to Settings</Link>
        </div>
      </div>

      <div className="card">
        {msg && (
          <div className="form-error" style={{ marginBottom: 10 }}>
            {msg}{" "}
            {msg.toLowerCase().includes("unauthorized") && (
              <a href="/login" className="small" style={{ textDecoration: "underline" }}>Sign in</a>
            )}
          </div>
        )}

        {loading ? (
          <div className="small muted">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="small muted">No users found.</div>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {rows.map((u) => (
              <div
                key={u.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 0",
                  borderTop: "1px solid var(--border)",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{u.fullName || "—"}</div>
                  <div className="small muted">{u.email}</div>
                  <div className="small muted">
                    {u.role} · {u.isActive ? "Active" : "Inactive"} · {new Date(u.createdAt).toLocaleDateString("en-GB")}
                  </div>
                </div>
                {u.id !== who?.id && (
                  <button
                    className="btn"
                    style={{ color: "#dc2626", borderColor: "#dc2626", fontSize: "0.85rem", flexShrink: 0 }}
                    onClick={() => deleteUser(u)}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {who && (
          <p className="small muted" style={{ marginTop: 8 }}>
            Signed in as: {who.fullName || who.email} ({who.role})
          </p>
        )}
      </div>
    </div>
  );
}
