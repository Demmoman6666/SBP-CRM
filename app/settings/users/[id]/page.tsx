// app/settings/users/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type Role = "ADMIN" | "MANAGER" | "REP" | "VIEWER";
type Permission =
  | "VIEW_SALES_HUB"
  | "VIEW_REPORTS"
  | "VIEW_CUSTOMERS"
  | "EDIT_CUSTOMERS"
  | "VIEW_CALLS"
  | "EDIT_CALLS"
  | "VIEW_PROFIT_CALC"
  | "VIEW_SETTINGS";

const PERMISSIONS: Permission[] = [
  "VIEW_SALES_HUB",
  "VIEW_REPORTS",
  "VIEW_CUSTOMERS",
  "EDIT_CUSTOMERS",
  "VIEW_CALLS",
  "EDIT_CALLS",
  "VIEW_PROFIT_CALC",
  "VIEW_SETTINGS",
];

type UserDTO = {
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
  const { id: rawId } = useParams<{ id: string }>();
  const id = useMemo(() => String(rawId || ""), [rawId]);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // form fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("REP");
  const [isActive, setIsActive] = useState<boolean>(true);
  const [overrides, setOverrides] = useState<Permission[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const canSave =
    fullName.trim().length > 0 &&
    email.trim().length > 0 &&
    (newPassword.length === 0 || (newPassword.length >= 8 && newPassword === confirm));

  function toggleOverride(p: Permission) {
    setOverrides((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function load() {
    if (!id) return;
    setLoading(true);
    setMsg(null);

    try {
      // absolute same-origin URL + cookies
      const url = `${window.location.origin}/api/users/${encodeURIComponent(id)}?ts=${Date.now()}`;
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      const body = await safeJson(res);

      if (!res.ok) {
        const err =
          (body as any)?.error ||
          (res.status === 401 ? "Unauthorized" : res.status === 403 ? "Forbidden" : "User not found.");
        setMsg(err);
        return;
      }

      const u: UserDTO = (body as any).user;

      // Pre-fill correctly
      setFullName(u.fullName || "");
      setEmail(u.email || "");
      setPhone(u.phone || "");
      setRole(u.role);
      setIsActive(!!u.isActive);
      setOverrides(Array.isArray(u.overrides) ? (u.overrides.map((o) => o.perm) as Permission[]) : []);

      // Clear any previous banner if this load succeeded
      setMsg(null);
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || !id) return;

    setSaving(true);
    setMsg(null);
    try {
      const payload: any = {
        fullName,
        email,
        phone: phone || null,
        role,
        isActive,
        overrides, // API accepts overrides or permissions
        permissions: overrides,
      };
      if (newPassword) {
        payload.newPassword = newPassword;
        payload.confirm = confirm;
      }

      const url = `${window.location.origin}/api/users/${encodeURIComponent(id)}`;
      const res = await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await safeJson(res);

      if (!res.ok) {
        throw new Error((j as any)?.error || "Update failed");
      }

      // Reload to refresh any derived state (and clear password boxes)
      setNewPassword("");
      setConfirm("");
      await load();
      setMsg("Saved ✔");
    } catch (e: any) {
      setMsg(e?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(next: boolean) {
    if (!id) return;
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
          <Link href="/settings/users" className="btn">
            Back to Users
          </Link>
          <Link href="/settings" className="btn">
            Back to Settings
          </Link>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="small muted">Loading…</div>
        ) : (
          <>
            {msg && (
              <div className={`form-error`} style={{ marginBottom: 10 }}>
                {msg}
              </div>
            )}

            {/* Form */}
            <form onSubmit={onSubmit} className="grid" style={{ gap: 12, maxWidth: 760 }}>
              <div className="grid grid-2" style={{ gap: 12 }}>
                <div className="field">
                  <label>Full Name</label>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-2" style={{ gap: 12 }}>
                <div className="field">
                  <label>Phone</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44…" />
                </div>
                <div className="field">
                  <label>Role</label>
                  <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                    <option value="ADMIN">ADMIN</option>
                    <option value="MANAGER">MANAGER</option>
                    <option value="REP">REP</option>
                    <option value="VIEWER">VIEWER</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Status</label>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <span className="small muted" style={{ minWidth: 64 }}>
                    {isActive ? "Active" : "Inactive"}
                  </span>
                  {isActive ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => toggleActive(false)}
                      disabled={saving}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => toggleActive(true)}
                      disabled={saving}
                    >
                      Reactivate
                    </button>
                  )}
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
                    autoComplete="new-password"
                    minLength={8}
                  />
                </div>
                <div className="field">
                  <label>Confirm Password</label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                    minLength={8}
                  />
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
          </>
        )}
      </div>
    </div>
  );
}
