"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

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

type SalesRep = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  territory: string | null;
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
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "reps" ? "reps" : "account";

  const [tab, setTab] = useState<"account" | "admin" | "reps">(initialTab as any);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [users, setUsers] = useState<UserRow[]>([]);
  const isAdmin = me?.role === "ADMIN";

  const [reps, setReps] = useState<SalesRep[]>([]);
  const [repsLoading, setRepsLoading] = useState(false);
  const [editingRep, setEditingRep] = useState<SalesRep | null>(null);
  const [newRep, setNewRep] = useState({ name: "", email: "", phone: "", territory: "" });
  const [repMsg, setRepMsg] = useState<string | null>(null);
  const [addingRep, setAddingRep] = useState(false);

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
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function loadReps() {
    setRepsLoading(true);
    try {
      const r = await fetch("/api/salesreps", { cache: "no-store" });
      setReps(await r.json());
    } finally {
      setRepsLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "reps") loadReps();
  }, [tab]);

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

  async function addRep() {
    setRepMsg(null);
    if (!newRep.name.trim()) { setRepMsg("Name is required"); return; }
    setAddingRep(true);
    try {
      const r = await fetch("/api/salesreps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRep),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed");
      setNewRep({ name: "", email: "", phone: "", territory: "" });
      setRepMsg("Rep added.");
      await loadReps();
    } catch (e: any) {
      setRepMsg(e.message || "Failed to add");
    } finally {
      setAddingRep(false);
    }
  }

  async function updateRep() {
    if (!editingRep) return;
    setRepMsg(null);
    try {
      const r = await fetch(`/api/salesreps/${editingRep.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingRep.name, email: editingRep.email, phone: editingRep.phone, territory: editingRep.territory }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed");
      setEditingRep(null);
      setRepMsg("Saved.");
      await loadReps();
    } catch (e: any) {
      setRepMsg(e.message || "Failed to save");
    }
  }

  async function deleteRep(rep: SalesRep) {
    if (!confirm(`Delete "${rep.name}"? Their customers and calls will be unlinked but not deleted.`)) return;
    setRepMsg(null);
    try {
      const r = await fetch(`/api/salesreps/${rep.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
      setRepMsg("Rep deleted.");
      await loadReps();
    } catch (e: any) {
      setRepMsg(e.message || "Delete failed");
    }
  }

  if (loading) {
    return <section className="card"><h1>Settings</h1><p className="small">Loading…</p></section>;
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1>Settings</h1>
          <div className="row" style={{ gap: 6 }}>
            <button className={tab === "account" ? "chip primary" : "chip"} onClick={() => setTab("account")}>Account</button>
            {isAdmin && (
              <>
                <button className={tab === "reps" ? "chip primary" : "chip"} onClick={() => setTab("reps")}>Sales Reps</button>
                <button className={tab === "admin" ? "chip primary" : "chip"} onClick={() => setTab("admin")}>Admin</button>
              </>
            )}
          </div>
        </div>
      </section>

      {tab === "account" && (
        <section className="card grid" style={{ gap: 12 }}>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field"><label>Full Name</label><input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
            <div className="field"><label>Contact Number</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="field"><label>Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          </div>
          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="field"><label>Current Password</label><input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} /></div>
            <div className="field"><label>New Password</label><input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} /></div>
            <div className="field"><label>&nbsp;</label><button className="primary" onClick={saveAccount} disabled={saving}>{saving ? "Saving…" : "Save"}</button></div>
          </div>
          {msg && <div className="small muted">{msg}</div>}
        </section>
      )}

      {tab === "reps" && isAdmin && (
        <div className="grid" style={{ gap: 16 }}>
          <section className="card">
            <h2 style={{ marginBottom: 12 }}>Add Sales Rep</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <div className="field"><label>Name *</label><input placeholder="e.g. Sarah Jones" value={newRep.name} onChange={(e) => setNewRep((p) => ({ ...p, name: e.target.value }))} /></div>
              <div className="field"><label>Email</label><input placeholder="sarah@example.com" value={newRep.email} onChange={(e) => setNewRep((p) => ({ ...p, email: e.target.value }))} /></div>
              <div className="field"><label>Phone</label><input placeholder="07700 000000" value={newRep.phone} onChange={(e) => setNewRep((p) => ({ ...p, phone: e.target.value }))} /></div>
              <div className="field"><label>Territory</label><input placeholder="e.g. SA postcodes" value={newRep.territory} onChange={(e) => setNewRep((p) => ({ ...p, territory: e.target.value }))} /></div>
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
              <button className="primary" onClick={addRep} disabled={addingRep}>{addingRep ? "Adding…" : "Add Rep"}</button>
              {repMsg && <span className="small muted">{repMsg}</span>}
            </div>
          </section>

          <section className="card">
            <h2 style={{ marginBottom: 12 }}>Existing Reps</h2>
            {repsLoading ? <p className="small muted">Loading…</p> : reps.length === 0 ? <p className="small muted">No reps yet.</p> : (
              <div style={{ display: "grid", gap: 10 }}>
                {reps.map((rep) => (
                  <div key={rep.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, background: "#fff" }}>
                    {editingRep?.id === rep.id ? (
                      <div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 10 }}>
                          <div className="field"><label>Name *</label><input value={editingRep.name} onChange={(e) => setEditingRep((p) => p ? { ...p, name: e.target.value } : p)} /></div>
                          <div className="field"><label>Email</label><input value={editingRep.email ?? ""} onChange={(e) => setEditingRep((p) => p ? { ...p, email: e.target.value } : p)} /></div>
                          <div className="field"><label>Phone</label><input value={editingRep.phone ?? ""} onChange={(e) => setEditingRep((p) => p ? { ...p, phone: e.target.value } : p)} /></div>
                          <div className="field"><label>Territory</label><input value={editingRep.territory ?? ""} onChange={(e) => setEditingRep((p) => p ? { ...p, territory: e.target.value } : p)} /></div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="primary" onClick={updateRep}>Save</button>
                          <button className="btn" onClick={() => setEditingRep(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{rep.name}</div>
                          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 3 }}>
                            {rep.email && <span className="small muted">✉ {rep.email}</span>}
                            {rep.phone && <span className="small muted">📞 {rep.phone}</span>}
                            {rep.territory && <span className="small muted">📍 {rep.territory}</span>}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <a href={`/reps/${rep.id}`} className="btn" style={{ fontSize: "0.8rem", padding: "5px 12px" }}>View Profile</a>
                          <button className="btn" style={{ fontSize: "0.8rem", padding: "5px 12px" }} onClick={() => { setEditingRep(rep); setRepMsg(null); }}>Edit</button>
                          <button className="btn" style={{ fontSize: "0.8rem", padding: "5px 12px", color: "#dc2626", borderColor: "#dc2626" }} onClick={() => deleteRep(rep)}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "admin" && isAdmin && (
        <section className="card">
          <h2>User Permissions</h2>
          {users.length === 0 ? <p className="small">No users.</p> : (
            <div className="grid" style={{ gap: 12 }}>
              {users.map((u) => {
                const feats = (u.features || {}) as Record<string, boolean>;
                return (
                  <div key={u.id} className="card" style={{ border: "1px solid var(--border)", padding: 12 }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <b>{u.fullName || u.email}</b>
                        <div className="small muted">{u.email}</div>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <label className="small row" style={{ gap: 6 }}>
                          Role:
                          <select value={u.role} onChange={(e) => setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role: e.target.value as any } : x)))}>
                            <option value="USER">User</option>
                            <option value="ADMIN">Admin</option>
                          </select>
                        </label>
                        <button className="primary" onClick={() => saveUser(u)}>Save</button>
                      </div>
                    </div>
                    <div className="grid" style={{ gap: 6, marginTop: 8 }}>
                      {FEATURE_LIST.map((f) => (
                        <label key={f.key} className="row small" style={{ gap: 8 }}>
                          <input type="checkbox" checked={!!feats[f.key]} onChange={(e) => {
                            const next = { ...(u.features || {}) };
                            next[f.key] = e.target.checked;
                            setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, features: next } : x)));
                          }} />
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
