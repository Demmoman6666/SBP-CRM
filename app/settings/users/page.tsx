// app/settings/users/page.tsx
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
  createdAt: string; // ISO
};

export const dynamic = "force-dynamic";

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return null; // handles 204/empty body
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
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
      // 1) Check who I am (and force cookie to be sent)
      const meRes = await fetch("/api/me", { credentials: "include", cache: "no-store" });
      const me = meRes.ok ? await safeJson(meRes) : null;
      setWho(me);

      if (!meRes.ok || !me || me.role !== "ADMIN") {
        setMsg("Unauthorized — admin access required. If you just changed domains/preview URLs, sign in again.");
        return;
      }

      // 2) Fetch users list (cookie included)
      const res = await fetch("/api/users", { credentials: "include", cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setMsg("Unauthorized");
        return;
      }

      const body = await safeJson(res);
      if (!res.ok) {
        const err = (body as any)?.error || `HTTP ${res.status}`;
        throw new Error(err);
      }

      // Accept either { users: [...] } or raw [...]
      const list: any[] = Array.isArray((body as any)?.users)
        ? (body as any).users
        : Array.isArray(body)
        ? (body as any)
        : [];

      const mapped: UserRow[] = list.map((u: any) => ({
        id: String(u.id),
        fullName: String(u.fullName ?? ""),
        email: String(u.email ?? ""),
        phone: u.phone ?? null,
        role: String(u.role) as Role,
        isActive: Boolean(u.isActive),
        createdAt: (u.createdAt && new Date(u.createdAt).toISOString()) || new Date().toISOString(),
      }));

      setRows(mapped);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
        {loading ? (
          <div className="small muted">Loading…</div>
        ) : (
          <>
            {msg && (
              <div className="form-error" style={{ marginBottom: 10 }}>
                {msg}
                {" "}
                {msg.toLowerCase().includes("unauthorized") && (
                  <a href="/login" className="small" style={{ textDecoration: "underline" }}>
                    Sign in
                  </a>
                )}
              </div>
            )}

            {rows.length === 0 ? (
              <div className="small muted">No users found.</div>
            ) : (
              <div className="grid" style={{ gap: 8 }}>
                <div className="small muted row" style={{ gap: 8 }}>
                  <div style={{ flex: "0 0 220px" }}>Name</div>
                  <div style={{ flex: "0 0 260px" }}>Email</div>
                  <div style={{ flex: "0 0 160px" }}>Role</div>
                  <div style={{ flex: "0 0 100px" }}>Status</div>
                  <div style={{ flex: "1 1 auto" }}>Created</div>
                </div>

                {rows.map((u) => (
                  <div
                    key={u.id}
                    className="row"
                    style={{
                      gap: 8,
                      padding: "8px 0",
                      borderTop: "1px solid var(--border)",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ flex: "0 0 220px" }}>{u.fullName || "—"}</div>
                    <div style={{ flex: "0 0 260px" }}>{u.email}</div>
                    <div style={{ flex: "0 0 160px" }}>{u.role}</div>
                    <div style={{ flex: "0 0 100px" }}>{u.isActive ? "Active" : "Inactive"}</div>
                    <div style={{ flex: "1 1 auto" }}>
                      {new Date(u.createdAt).toLocaleString("en-GB")}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {who && (
              <p className="small muted" style={{ marginTop: 8 }}>
                Signed in as: {who.fullName || who.email} ({who.role})
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
