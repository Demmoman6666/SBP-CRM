// app/settings/account/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Me = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: "ADMIN" | "MANAGER" | "REP" | "VIEWER";
};

export default function AccountSettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  // form fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // password fields
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // ui state
  const [saving, setSaving] = useState(false);
  const [msgOK, setMsgOK] = useState<string | null>(null);
  const [msgErr, setMsgErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/me", { cache: "no-store" });
        if (!r.ok) throw new Error("Failed to load profile");
        const j = (await r.json()) as Me;
        setMe(j);
        setFullName(j.fullName ?? "");
        setEmail(j.email ?? "");
        setPhone(j.phone ?? "");
      } catch (e: any) {
        setMsgErr(e?.message || "Could not load account.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsgErr(null);
    setMsgOK(null);

    if (newPassword || confirmPassword || currentPassword) {
      if (newPassword.length < 8) {
        setSaving(false);
        setMsgErr("New password must be at least 8 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setSaving(false);
        setMsgErr("New password and confirmation do not match.");
        return;
      }
      if (!currentPassword) {
        setSaving(false);
        setMsgErr("Please enter your current password to change it.");
        return;
      }
    }

    const body: any = {
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
    };
    if (newPassword) {
      body.currentPassword = currentPassword;
      body.newPassword = newPassword;
    }

    try {
      const res = await fetch("/api/settings/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Update failed");

      setMsgOK("Account updated ✔");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e: any) {
      setMsgErr(e?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid" style={{ gap: 16 }}>
        <section className="card"><div className="small muted">Loading…</div></section>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Account Settings</h1>
            <p className="small">Manage your profile and password.</p>
          </div>
          <Link href="/settings" className="small" style={{ textDecoration: "underline" }}>
            &larr; Back to Settings
          </Link>
        </div>
      </section>

      {!me ? (
        <section className="card">
          <div className="small" style={{ color: "#b91c1c" }}>
            You must be signed in to view this page.
          </div>
        </section>
      ) : (
        <section className="card">
          <form onSubmit={onSave} className="grid" style={{ gap: 12, maxWidth: 720 }}>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <div className="field">
                <label>Full Name</label>
                <input
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
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
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="field">
                <label>Role</label>
                <input className="input" value={me.role} disabled />
                <div className="form-hint">Role is managed by an administrator.</div>
              </div>
            </div>

            <div style={{ height: 1, background: "var(--border)", margin: "6px 0 2px" }} />

            <h3 style={{ margin: 0 }}>Change Password</h3>
            <div className="grid grid-3" style={{ gap: 12 }}>
              <div className="field">
                <label>Current Password</label>
                <input
                  type="password"
                  className="input"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="field">
                <label>New Password</label>
                <input
                  type="password"
                  className="input"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="field">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  className="input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                />
              </div>
            </div>

            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <button className="primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
              {msgOK && <span className="small" style={{ color: "#15803d" }}>{msgOK}</span>}
              {msgErr && <span className="small" style={{ color: "#b91c1c" }}>{msgErr}</span>}
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
