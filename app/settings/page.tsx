"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

type Me = {
  id: string;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  role: "ADMIN" | "MANAGER" | "REP" | "VIEWER";
  features: Record<string, boolean> | null;
};

type UserRow = {
  id: string;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  role: "ADMIN" | "MANAGER" | "REP" | "VIEWER";
  isActive: boolean;
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

function SettingsInner() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "reps" ? "reps" : searchParams.get("tab") === "admin" ? "admin" : "account";

  const [tab, setTab] = useState<"account" | "admin" | "reps" | "tools">(initialTab as any);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  // account
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // admin users
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userMsg, setUserMsg] = useState<string | null>(null);
  const isAdmin = me?.role === "ADMIN";

  // sales reps
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [repsLoading, setRepsLoading] = useState(false);
  const [toolDays, setToolDays] = useState(90);
  const [toolPreview, setToolPreview] = useState<any>(null);
  const [toolRunning, setToolRunning] = useState(false);
  const [toolMsg, setToolMsg] = useState<string | null>(null);
  const [editingRep, setEditingRep] = useState<SalesRep | null>(null);
  const [newRep, setNewRep] = useState({ name: "", email: "", phone: "", territory: "" });
  const [repMsg, setRepMsg] = useState<string | null>(null);
  const [addingRep, setAddingRep] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/me", { cache: "no-store" });
        if (!r.ok) throw new Error("Unauthenticated");
        const j = (await r.json()) as Me;
        setMe(j);
        setFullName(j.fullName ?? "");
        setPhone(j.phone ?? "");
        setEmail(j.email ?? "");
        if (j.role === "ADMIN") {
          await loadUsers();
        }
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function loadUsers() {
    const list = await fetch("/api/admin/users", { cache: "no-store" }).then((x) => x.json());
    setUsers(list ?? []);
  }

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
    setUserMsg(null);
    const r = await fetch(`/api/admin/users/${u.id}/permissions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: u.role, features: u.features || {} }),
    });
    if (r.ok) {
      setUserMsg("Saved.");
    } else {
      const j = await r.json().catch(() => ({}));
      setUserMsg(j?.error || "Update failed");
    }
  }

  async function deleteUser(u: UserRow) {
    if (!confirm(`Delete user "${u.fullName || u.email}"? This cannot be undone.`)) return;
    setUserMsg(null);
    const r = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    if (r.ok) {
      setUserMsg("User deleted.");
      await loadUsers();
    } else {
      const j = await r.json().catch(() => ({}));
      setUserMsg(j?.error || "Delete failed");
    }
  }

  async function syncUserAsRep(u: UserRow) {
    setRepMsg(null);
    try {
      const r = await fetch("/api/salesreps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: u.fullName || u.email, email: u.email, phone: u.phone }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed");
      setRepMsg(`${u.fullName || u.email} added as a sales rep.`);
      if (tab === "reps") await loadReps();
    } catch (e: any) {
      setRepMsg(e.message || "Failed");
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
                <button className={tab === "tools" ? "chip primary" : "chip"} onClick={() => setTab("tools")}>Tools</button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ---- Account ---- */}
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

      {/* ---- Sales Reps ---- */}
      {tab === "reps" && isAdmin && (
        <div className="grid" style={{ gap: 16 }}>

          {/* Promote a user to rep */}
          {users.filter(u => u.isActive).length > 0 && (
            <section className="card">
              <h2 style={{ marginBottom: 4 }}>Add User as Sales Rep</h2>
              <p className="small muted" style={{ marginBottom: 12 }}>Quickly add an existing CRM user as a sales rep.</p>
              <div style={{ display: "grid", gap: 8 }}>
                {users.filter(u => u.isActive && u.fullName).map(u => (
                  <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{u.fullName}</div>
                      <div className="small muted">{u.email}</div>
                    </div>
                    <button className="btn" style={{ fontSize: "0.8rem", padding: "5px 12px" }} onClick={() => syncUserAsRep(u)}>
                      + Add as Rep
                    </button>
                  </div>
                ))}
              </div>
              {repMsg && <div className="small muted" style={{ marginTop: 8 }}>{repMsg}</div>}
            </section>
          )}

          {/* Add rep manually */}
          <section className="card">
            <h2 style={{ marginBottom: 12 }}>Add Rep Manually</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <div className="field"><label>Name *</label><input placeholder="e.g. Sarah Jones" value={newRep.name} onChange={(e) => setNewRep((p) => ({ ...p, name: e.target.value }))} /></div>
              <div className="field"><label>Email</label><input placeholder="sarah@example.com" value={newRep.email} onChange={(e) => setNewRep((p) => ({ ...p, email: e.target.value }))} /></div>
              <div className="field"><label>Phone</label><input placeholder="07700 000000" value={newRep.phone} onChange={(e) => setNewRep((p) => ({ ...p, phone: e.target.value }))} /></div>
              <div className="field"><label>Territory</label><input placeholder="e.g. SA postcodes" value={newRep.territory} onChange={(e) => setNewRep((p) => ({ ...p, territory: e.target.value }))} /></div>
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
              <button className="primary" onClick={addRep} disabled={addingRep}>{addingRep ? "Adding…" : "Add Rep"}</button>
            </div>
          </section>

          {/* Existing reps */}
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

      {/* ---- Admin ---- */}
      {tab === "tools" && isAdmin && (
        <div className="grid" style={{ gap: 16 }}>
          <section className="card">
            <h2 style={{ marginBottom: 4 }}>Unassign Inactive Customers</h2>
            <p className="small muted" style={{ marginBottom: 16 }}>
              Removes the sales rep tag from customers who have not placed an order within the selected number of days.
              Run a preview first to see who would be affected before committing.
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
              <div className="field">
                <label>Inactive threshold (days)</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={toolDays}
                  onChange={e => setToolDays(Math.max(1, parseInt(e.target.value) || 90))}
                  style={{ width: 120 }}
                />
              </div>
              <button
                className="btn"
                disabled={toolRunning}
                onClick={async () => {
                  setToolRunning(true); setToolMsg(null); setToolPreview(null);
                  try {
                    const r = await fetch(`/api/admin/unassign-inactive-reps?days=${toolDays}`);
                    const j = await r.json();
                    if (!r.ok) throw new Error(j.error || "Failed");
                    setToolPreview(j);
                  } catch (e: any) { setToolMsg(e.message); }
                  finally { setToolRunning(false); }
                }}
              >
                {toolRunning ? "Checking..." : "Preview"}
              </button>
              {toolPreview && (
                <button
                  className="primary"
                  disabled={toolRunning || toolPreview.wouldUnassign === 0}
                  onClick={async () => {
                    if (!confirm(`This will remove the rep assignment from ${toolPreview.wouldUnassign} customers. Continue?`)) return;
                    setToolRunning(true); setToolMsg(null);
                    try {
                      const r = await fetch(`/api/admin/unassign-inactive-reps?days=${toolDays}&confirm=1&shopify=1`);
                      const j = await r.json();
                      if (!r.ok) throw new Error(j.error || "Failed");
                      const shopifyLine = j.shopifyUpdated > 0 ? ` ${j.shopifyUpdated} Shopify tags removed.` : '';
                      const failLine = j.shopifyFailed > 0 ? ` ${j.shopifyFailed} Shopify updates failed.` : '';
                      setToolMsg(j.message + shopifyLine + failLine);
                      setToolPreview(null);
                    } catch (e: any) { setToolMsg(e.message); }
                    finally { setToolRunning(false); }
                  }}
                >
                  Confirm &amp; Run ({toolPreview.wouldUnassign} customers)
                </button>
              )}
            </div>

            {toolMsg && <div className="small" style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#dcfce7", color: "#16a34a", fontWeight: 600 }}>{toolMsg}</div>}

            {toolPreview && (
              <div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
                  <div className="card" style={{ textAlign: "center", flex: "1 1 120px" }}>
                    <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#dc2626" }}>{toolPreview.wouldUnassign}</div>
                    <div className="small muted">Would be unassigned</div>
                  </div>
                  <div className="card" style={{ textAlign: "center", flex: "1 1 120px" }}>
                    <div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{toolPreview.total}</div>
                    <div className="small muted">Total assigned</div>
                  </div>
                  <div className="card" style={{ textAlign: "center", flex: "1 1 120px" }}>
                    <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#16a34a" }}>{toolPreview.total - toolPreview.wouldUnassign}</div>
                    <div className="small muted">Would remain</div>
                  </div>
                  <div className="card" style={{ textAlign: "center", flex: "1 1 120px" }}>
                    <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#2563eb" }}>{toolPreview.withShopifyId || 0}</div>
                    <div className="small muted">Shopify tags to remove</div>
                  </div>
                </div>

                {toolPreview.preview?.length > 0 && (
                  <div>
                    <div className="small muted" style={{ marginBottom: 8 }}>
                      Showing first {toolPreview.preview.length} of {toolPreview.wouldUnassign} — customers with no orders since {toolPreview.cutoff}:
                    </div>
                    <div style={{ display: "grid", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                      {toolPreview.preview.map((c: any) => (
                        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{c.salonName}</div>
                            <div className="small muted">Rep: {c.repName || "—"}</div>
                          </div>
                          <div className="small muted" style={{ flexShrink: 0 }}>
                            {c.lastOrderAt ? `Last order: ${c.lastOrderAt}` : "Never ordered"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "admin" && isAdmin && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2>User Management</h2>
            {userMsg && <span className="small muted">{userMsg}</span>}
          </div>
          {users.length === 0 ? <p className="small">No users.</p> : (
            <div className="grid" style={{ gap: 12 }}>
              {users.map((u) => {
                const feats = (u.features || {}) as Record<string, boolean>;
                return (
                  <div key={u.id} className="card" style={{ border: "1px solid var(--border)", padding: 12 }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <b>{u.fullName || u.email}</b>
                        <div className="small muted">{u.email}</div>
                        <div className="small muted">{u.isActive ? "Active" : "Inactive"}</div>
                      </div>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <label className="small row" style={{ gap: 6 }}>
                          Role:
                          <select value={u.role} onChange={(e) => setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role: e.target.value as any } : x)))}>
                            <option value="ADMIN">Admin</option>
                            <option value="MANAGER">Manager</option>
                            <option value="REP">Rep</option>
                            <option value="VIEWER">Viewer</option>
                          </select>
                        </label>
                        <button className="primary" onClick={() => saveUser(u)}>Save</button>
                        {u.id !== me?.id && (
                          <button
                            className="btn"
                            style={{ color: "#dc2626", borderColor: "#dc2626" }}
                            onClick={() => deleteUser(u)}
                          >
                            Delete
                          </button>
                        )}
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

export default function SettingsPage() {
  return (
    <Suspense fallback={<section className="card"><h1>Settings</h1><p className="small">Loading…</p></section>}>
      <SettingsInner />
    </Suspense>
  );
}
