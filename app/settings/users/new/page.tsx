// app/settings/users/new/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const PERMISSIONS = [
  "VIEW_SALES_HUB",
  "VIEW_REPORTS",
  "VIEW_SETTINGS",
  "MANAGE_USERS",
] as const;
type Permission = typeof PERMISSIONS[number];

// This page uses auth/cookies; avoid static pre-render surprises.
export const dynamic = "force-dynamic";

export default function NewUserPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">("USER");
  const [password, setPassword] = useState("");
  const [features, setFeatures] = useState<Permission[]>([]);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // If Admin is selected, auto-ensure admin perms are present
  useEffect(() => {
    if (role === "ADMIN") {
      setFeatures((prev) => {
        const need: Permission[] = ["VIEW_SETTINGS", "MANAGE_USERS"];
        const next = new Set(prev);
        need.forEach((p) => next.add(p));
        return Array.from(next);
      });
    } else {
      // Optional: drop admin-only perms when switching back to USER
      setFeatures((prev) => prev.filter((p) => p !== "VIEW_SETTINGS" && p !== "MANAGE_USERS"));
    }
  }, [role]);

  function toggleFeature(p: Permission) {
    setFeatures((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    setOk(null);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,            // ⬅️ send fullName (server requires this)
          email,
          phone,
          password,
          role,
          // send both keys to be compatible with either API naming
          features,
          permissions: features,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to create user");

      setOk(`User ${json.user?.email || email} created`);
      setFullName("");
      setEmail("");
      setPhone("");
      setPassword("");
      setRole("USER");
      setFeatures([]);
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>New User</h1>
            <p className="small">Admins can invite or add users and assign permissions.</p>
          </div>
          <Link href="/settings" className="small" style={{ textDecoration: "underline" }}>
            &larr; Back to Settings
          </Link>
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
              <label>Password</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </div>
          </div>

          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Role</label>
              <select
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value as "ADMIN" | "USER")}
              >
                <option value="USER">User</option>
                <option value="ADMIN">Admin</option>
              </select>
              <div className="form-hint">
                Admins automatically get “Settings” and “Manage Users”.
              </div>
            </div>

            <div className="field">
              <label>Permissions</label>
              <div className="grid" style={{ gap: 6 }}>
                {PERMISSIONS.map((p) => (
                  <label key={p} className="row small" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={features.includes(p)}
                      onChange={() => toggleFeature(p)}
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <button className="primary" type="submit" disabled={saving}>
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
