// app/settings/users/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Role = "ADMIN" | "MANAGER" | "REP" | "VIEWER";
const ROLES: Role[] = ["ADMIN", "MANAGER", "REP", "VIEWER"];

// Keep this in sync with your Prisma enum Permission
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
type Permission = typeof PERMISSIONS[number];

type UserDto = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  overrides?: { perm: Permission }[];
  createdAt?: string;
  updatedAt?: string;
};

export const dynamic = "force-dynamic";

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export default function EditUserPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // form fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState<string | "">("");
  const [role, setRole] = useState<Role>("REP");
  const [isActive, setIsActive] = useState<boolean>(true);
  const [overrides, setOverrides] = useState<Permission[]>([]);

  // password fields (optional)
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const canSave =
    !!fullName && !!email && (!newPassword || (newPassword.length >= 8 && newPassword === confirm));

  const pwMismatch = newPassword.length > 0 && confirm.length > 0 && newPassword !== confirm;
  const pwTooShort = newPassword.length > 0 && newPassword.length < 8;

  async function load() {
    setLoading(true);
    setMsg(null);

    try {
      if (!id) {
        setMsg("Invalid user id.");
        return;
      }

      const url = `${window.location.origin}/api/users/${encodeURIComponent(id)}?ts=${Date.now()}`;
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      const body = await safeJson(res);

      if (!res.ok) {
        const err =
          (body as any)?.error ||
          (res.status === 401 ? "Unauthorized" : res.status === 404 ? "User not found." : `HTTP ${res.status}`);
        setMsg(err);
        return;
      }

      const u = (body as any).user as UserDto;

      setFullName(u.fullName || "");
      setEmail(u.email || "");
      setPhone(u.phone || "");
      setRole(u.role);
      setIsActive(!!u.isActive);
      setOverrides((u.overrides || []).map((o) => o.perm));
    } catch (e: any) {
      setMsg(e?.message || "Failed to load user");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function toggleOverride(p: Permission) {
    setOverrides((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setSaving(true);
    setMsg(null);

    try {
      const url = `${window.location.origin}/api/users/${encodeURIComponent(id)}`;
      const res = await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          phone: phone || null,
          role,
          isActive,
          // Only send password if provided
          ...(newPassword ? { newPassword, confirm } : {}),
          // Replace overrides (send array even if empty)
          overrides,
        }),
      });

      const j = await safeJson(res);
      if (!res.ok) {
        throw new Error((j as any)?.error || "Update failed");
      }

      setMsg("Saved ✔");
      // reset password fields after successful save
      setNewPassword("");
      setConfirm("");
      // refresh form with server copy (keeps us in sync)
      if ((j as any)?.user) {
        const u = (j as any).user as UserDto;
        setFullName(u.fullName || "");
        setEmail(u.email || "");
        setPhone(u.phone || "");
        setRole(u.role);
        setIsActive(!!u.isActive);
        setOverrides((u.overrides || []).map((o) => o.perm));
      }
    } catch (e: any) {
      setMsg(e?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(next: boolean) {
    setSaving(true);
    setMsg(null);
    try {
      const url = `${window.location.origin}/api/users/${encodeURIComponent(id)}`;
      const res = await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      const j = await safeJson(res);
      if (!res.ok) throw new Error((j as any)?.error || "Update failed");
      setIsActive(next);
      setMsg(next ? "User reactivated ✔" : "User deactivated ✔");
    } catch (e: any) {
      setMsg(e?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  }

  const errorBorder = useMemo<React.CSSProperties>(() => ({ borderColor: "#b91c1c" }), []);

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
        ) : msg && msg.toLowerCase().includes("not found") ? (
          <div className="form-error">User not found.</div>
        ) : (
          <form onSubmit={save} className="grid" style={{ gap: 12, maxWidth: 720 }}>
            {msg && <div className={msg.includes("✔") ? "small" : "form-error"}>{msg}</div>}

            <div className="grid grid-2" style={{ gap: 12 }}>
              <div className="field">
                <label>Full Name</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div className="field">
                <label>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
            </div>

            <div className="grid grid-2" style={{ gap: 12 }}>
              <div className="field">
                <label>Phone</label>
                <input value={phone ?? ""} onChange={(e) => setPhone(e.target.value)} placeholder="+44…" />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>Status</label>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <span className="small">{isActive ? "Active" : "Inactive"}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => toggleActive(!isActive)}
                  disabled={saving}
                >
                  {isActive ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>

            <div className="grid grid-2" style={{ gap: 12 }}>
              <div className="field">
                <label>New Password (optional)</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  style={pwTooShort ? errorBorder : undefined}
                />
                {pwTooShort && (
                  <div className="small" style={{ color: "#b91c1c", marginTop: 4 }}>
                    Password must be at least 8 characters.
                  </div>
                )}
              </div>

              <div className="field">
                <label>Confirm Password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  minLength={8}
                  style={pwMismatch ? errorBorder : undefined}
                />
                {pwMismatch && (
                  <div className="small" style={{ color: "#b91c1c", marginTop: 4 }}>
                    Passwords do not match.
                  </div>
                )}
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

            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <button className="primary" type="submit" disabled={saving || !canSave}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
