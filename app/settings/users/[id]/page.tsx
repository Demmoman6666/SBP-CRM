// app/settings/users/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Role = "ADMIN" | "MANAGER" | "REP" | "VIEWER";
const ROLES: Role[] = ["ADMIN", "MANAGER", "REP", "VIEWER"];

const PERMISSIONS = [
  "VIEW_SALES_HUB",
  "VIEW_REPORTS",
  "VIEW_CUSTOMERS",
  "EDIT_CUSTOMERS",
  "VIEW_CALLS",
  "EDIT_CALLS",
  "VIEW_PROFIT_CALC",
  "VIEW_SETTINGS",
] as const;
type Perm = typeof PERMISSIONS[number];

type LoadedUser = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  overrides: { perm: Perm }[];
};

export default function EditUserPage({ params }: { params: { id: string } }) {
  const id = params.id;

  const [u, setU] = useState<LoadedUser | null>(null);
  const [role, setRole] = useState<Role>("REP");
  const [isActive, setIsActive] = useState<boolean>(true);
  const [overrides, setOverrides] = useState<Perm[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);
      try {
        const res = await fetch(`/api/users/${id}`, { credentials: "include", cache: "no-store" });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Load failed");
        const user = j.user as LoadedUser;
        setU(user);
        setRole(user.role);
        setIsActive(user.isActive);
        setOverrides((user.overrides ?? []).map((o) => o.perm));
      } catch (e: any) {
        setMsg(e?.message || "Failed to load user");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  function toggleOverride(p: Perm) {
    setOverrides((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setOk(null);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          isActive,
          overrides,
          newPassword: newPassword || undefined,
          confirm: confirm || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Update failed");
      setOk("User updated");
      setNewPassword("");
      setConfirm("");
    } catch (e: any) {
      setMsg(e?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1>Edit User</h1>
        <div className="row" style={{ gap: 8 }}>
          <Link href="/settings/users" className="btn">Back to Users</Link>
          <Link href="/settings" className="btn">Back to Settings</Link>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="small muted">Loading…</div>
        ) : !u ? (
          <div className="form-error">User not found.</div>
        ) : (
          <form onSubmit={submit} className="grid" style={{ gap: 12, maxWidth: 720 }}>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <div className="field">
                <label>Full Name</label>
                <input className="input" value={u.fullName} disabled />
              </div>
              <div className="field">
                <label>Email</label>
                <input className="input" value={u.email} disabled />
              </div>
            </div>

            <div className="grid grid-2" style={{ gap: 12 }}>
              <div className="field">
                <label>Role</label>
                <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Status</label>
                <div className="row" style={{ gap: 10, alignItems: "center" }}>
                  <input
                    id="active"
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.currentTarget.checked)}
                  />
                  <label htmlFor="active">{isActive ? "Active" : "Inactive"}</label>
                </div>
              </div>
            </div>

            <div className="field">
              <label>Permission overrides (optional)</label>
              <div className="grid" style={{ gap: 6 }}>
                {PERMISSIONS.map((p) => (
                  <label key={p} className="row small" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={overrides.includes(p)}
                      onChange={() => toggleOverride(p)}
                    />
                    {p}
                  </label>
                ))}
              </div>
              <div className="form-hint">
                If left blank, the user’s access is determined by their role.
              </div>
            </div>

            <div className="grid grid-2" style={{ gap: 12 }}>
              <div className="field">
                <label>New Password</label>
                <input
                  type="password"
                  className="input"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Leave empty to keep current"
                />
              </div>
              <div className="field">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  className="input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter new password"
                />
              </div>
            </div>

            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <button className="primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
              {ok && <span className="small" style={{ color: "#15803d" }}>{ok}</span>}
              {msg && <span className="small" style={{ color: "#b91c1c" }}>{msg}</span>}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
