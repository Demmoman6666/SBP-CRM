// app/settings/users/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Must match prisma Permission enum
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
type Permission = (typeof PERMISSIONS)[number];

// Must match prisma Role enum
type Role = "ADMIN" | "MANAGER" | "REP" | "VIEWER";

export default function NewUserPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("REP"); // default to REP (valid enum)
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [overrides, setOverrides] = useState<Permission[]>([]);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // derived validation
  const passTooShort = password.length > 0 && password.length < 8;
  const passwordsMatch = password.length >= 8 && confirm.length > 0 && password === confirm;
  const canSubmit = !!fullName && !!email && password.length >= 8 && password === confirm;

  // If Admin is selected, ensure VIEW_SETTINGS is included in overrides (harmless if API ignores for admins)
  useEffect(() => {
    if (role === "ADMIN") {
      setOverrides((prev) => (prev.includes("VIEW_SETTINGS") ? prev : [...prev, "VIEW_SETTINGS"]));
    } else {
      // user changed away from ADMIN: allow overrides to drop VIEW_SETTINGS if they uncheck it
      // (no automatic removal so they can still grant VIEW_SETTINGS to managers if desired)
    }
  }, [role]);

  function toggleOverride(p: Permission) {
    setOverrides((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);

    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        credentials: "include", // ensure sbp_session cookie is sent
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          role,                // one of ADMIN | MANAGER | REP | VIEWER
          password,
          confirm,             // if your API checks this, it’s here
          overrides,           // fine-grained Permission[] (optional on server)
          permissions: overrides, // keep compatibility if API expects "permissions"
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to create user");

      setOk(`User ${json?.user?.email ?? email} created`);
      setFullName("");
      setEmail("");
      setPhone("");
      setPassword("");
      setConfirm("");
      setRole("REP");
      setOverrides([]);
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  }

  // simple helper for input borders when invalid
  const errorBorder = useMemo<React.CSSProperties>(() => ({ borderColor: "#b91c1c" }), []);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>New User</h1>
            <p className="small">Admins can add users and set roles/permissions.</p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Link href="/settings/users" className="btn">Back to Users</Link>
            <Link href="/settings" className="btn">Back to Settings</Link>
          </div>
        </div>
      </section>

      <section className="card">
        <form onSubmit={submit} className="grid" style={{ gap: 12, maxWidth: 720 }}>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Full Name</label>
              <input
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith"
                required
              />
            </div>
            <div className="field">
              <label>Phone</label>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+44…"
              />
            </div>
          </div>

          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                required
              />
            </div>
            <div className="field">
              <label>Role</label>
              <select
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                <option value="ADMIN">Admin</option>
                <option value="MANAGER">Manager</option>
                <option value="REP">Rep</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <div className="form-hint">Admins implicitly have full access; overrides are optional.</div>
            </div>
          </div>

          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                minLength={8}
                required
                style={passTooShort ? errorBorder : undefined}
                aria-invalid={passTooShort ? true : undefined}
                autoComplete="new-password"
              />
              {passTooShort && (
                <div className="small" style={{ color: "#b91c1c", marginTop: 4 }}>
                  Password must be at least 8 characters.
                </div>
              )}
            </div>
            <div className="field">
              <label>Confirm Password</label>
              <input
                type="password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter password"
                minLength={8}
                required
                style={confirm && password !== confirm ? errorBorder : undefined}
                aria-invalid={confirm && password !== confirm ? true : undefined}
                autoComplete="new-password"
              />
              {confirm && password !== confirm && (
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
              If left blank, the user’s access is determined by their role. Check items to grant extra access.
            </div>
          </div>

          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <button className="primary" type="submit" disabled={saving || !canSubmit}>
              {saving ? "Creating…" : "Create User"}
            </button>
            {ok && <span className="small" style={{ color: "#15803d" }}>{ok}</span>}
            {err && <span className="small" style={{ color: "#b91c1c" }}>{err}</span>}
          </div>
        </form>
      </section>
    </div>
  );
}
