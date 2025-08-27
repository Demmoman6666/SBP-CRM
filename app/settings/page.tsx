// app/settings/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Me = {
  id: string;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  role: "USER" | "ADMIN";
  features: Record<string, boolean> | null;
};

type UserRow = {
  id: string;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  role: "USER" | "ADMIN";
  features: Record<string, boolean> | null;
};

const FEATURE_LIST: Array<{ key: string; label: string }> = [
  { key: "salesHub", label: "Sales Hub" },
  { key: "reports", label: "Reporting (all)" },
  { key: "reports.calls", label: "Report: Calls" },
  { key: "reports.gap", label: "Report: GAP Analysis" },
  { key: "reports.dropoff", label: "Report: Customer Drop-off" },
  { key: "tools.profitCalculator", label: "Tool: Profit Calculator" },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<"account" | "admin">("account");

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  // account form
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // admin
  const [users, setUsers] = useState<UserRow[]>([]);
  const isAdmin = me?.role === "ADMIN";

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/settings/account", { cache: "no-store" });
        if (!r.ok) throw new Error("Unauthenticated");
        const j = (await r.json()) as Me;
        setMe(j);
        setFullName(j.fullName ?? "");
        setPhone(j.phone ?? "");
        setEmail(j.email ?? "");
        if (j.role === "ADMIN") {
          const list = await fetch("/api/admin/users", { cache: "no-store" }).then((x) => x.json());
          setUsers(list ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function saveAccount() {
    setSaving(true);
    setMsg(null);
    try {
      const body: any = { fullName, phone, email };
      if (curPw && newPw) body.passwordChange = { currentPassword: curPw, newPassword: newPw };
      const r = await fetch("/api/settings/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Save failed");
      setMe(j);
      setCurPw(""); setNewPw("");
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveUser(u: UserRow) {
    const r = await fetch(`/api/admin/users/${u.id}/permissions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: u.role, features: u.features || {} }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j?.error || "Update failed");
    }
  }

  if (loading) {
    return (
      <section className="card">
        <h1>Settings</h1>
        <p className="small">Loading…</p>
      </section>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1>Settings</h1>
          <div className="row" style={{ gap: 6 }}>
            <button
              className={tab === "account" ? "chip primary" : "chip"}
              onClick={() => setTab("account")}
            >
              Account
            </button>
            {isAdmin && (
              <button
                className={tab === "admin" ? "chip primary" : "chip"}
                onClick={() => setTab("admin")}
              >
                Admin
              </button>
            )}
          </div>
        </div>
      </section>

      {tab === "account" && (
        <section className="card grid" style={{ gap: 12 }}>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Full Name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="field">
              <label>Contact Number</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="field">
              <label>Current Password</label>
              <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
            </div>
            <div className="field">
              <label>New Password</label>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button className="primary" onClick={saveAccount} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {msg && <div className="small muted">{msg}</div>}
        </section>
      )}

      {tab === "admin" && isAdmin && (
        <section className="card">
          <h2>User Permissions</h2>
          {users.length === 0 ? (
            <p className="small">No users.</p>
          ) : (
            <div className="grid" style={{ gap: 12 }}>
              {users.map((u) => {
                const feats = (u.features || {}) as Record<string, boolean>;
                return (
                  <div
                    key={u.id}
                    className="card"
                    style={{ border: "1px solid var(--border)", padding: 12 }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <b>{u.fullName || u.email}</b>
                        <div className="small muted">{u.email}</div>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <label className="small row" style={{ gap: 6 }}>
                          Role:
                          <select
                            value={u.role}
                            onChange={(e) =>
                              setUsers((prev) =>
                                prev.map((x) => (x.id === u.id ? { ...x, role: e.target.value as any } : x))
                              )
                            }
                          >
                            <option value="USER">User</option>
                            <option value="ADMIN">Admin</option>
                          </select>
                        </label>
                        <button className="primary" onClick={() => saveUser(u)}>
                          Save
                        </button>
                      </div>
                    </div>

                    <div className="grid" style={{ gap: 6, marginTop: 8 }}>
                      {FEATURE_LIST.map((f) => (
                        <label key={f.key} className="row small" style={{ gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={!!feats[f.key]}
                            onChange={(e) => {
                              const next = { ...(u.features || {}) };
                              next[f.key] = e.target.checked;
                              setUsers((prev) =>
                                prev.map((x) => (x.id === u.id ? { ...x, features: next } : x))
                              );
                            }}
                          />
                          {f.label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
