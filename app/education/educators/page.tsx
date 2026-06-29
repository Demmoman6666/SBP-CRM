"use client";

import { useEffect, useState } from "react";

type Educator = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  specialisms: string[];
  active: boolean;
};

const OUR_BRANDS = ["REF Stockholm", "Neal & Wolf", "Goddess Maintenance Company", "Procare"];

export default function EducatorsPage() {
  const [educators, setEducators] = useState<Educator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [specialisms, setSpecialisms] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/educators", { cache: "no-store" })
      .then(r => r.json())
      .then(j => setEducators(Array.isArray(j) ? j : []))
      .catch(() => setEducators([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError(null);
    const r = await fetch("/api/educators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone, specialisms }),
    });
    const j = await r.json();
    if (!r.ok) { setError(j.error || "Failed"); setSaving(false); return; }
    setName(""); setEmail(""); setPhone(""); setSpecialisms([]);
    setShowForm(false); setSaving(false);
    load();
  }

  async function deactivate(id: string) {
    if (!confirm("Remove this educator?")) return;
    await fetch("/api/educators/" + id, { method: "DELETE" });
    load();
  }

  function toggleSpecialism(s: string) {
    setSpecialisms(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1 style={{ marginBottom: 2 }}>Educators</h1>
            <p className="small muted">Your internal education team.</p>
          </div>
          <button className="primary" onClick={() => setShowForm(v => !v)}>
            {showForm ? "Cancel" : "+ Add Educator"}
          </button>
        </div>
      </section>

      {showForm && (
        <section className="card">
          <h2 style={{ marginBottom: 14 }}>New Educator</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
            <div className="field">
              <label>Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+44..." />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Brand specialisms</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              {OUR_BRANDS.map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => toggleSpecialism(b)}
                  style={{ padding: "5px 14px", borderRadius: 999, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", border: "1px solid var(--border)", background: specialisms.includes(b) ? "var(--pink)" : "#fff", color: specialisms.includes(b) ? "#fff" : "var(--text)" }}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
          {error && <div className="small" style={{ color: "var(--red)", marginBottom: 8 }}>{error}</div>}
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save Educator"}
          </button>
        </section>
      )}

      <section className="card">
        {loading && <p className="small muted">Loading...</p>}
        {!loading && educators.length === 0 && (
          <p className="small muted" style={{ textAlign: "center", padding: "20px 0" }}>
            No educators added yet. Click "+ Add Educator" to get started.
          </p>
        )}
        <div style={{ display: "grid", gap: 10 }}>
          {educators.map(e => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 12, background: "#fff", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 4 }}>{e.name}</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {e.email && <span className="small muted">✉ {e.email}</span>}
                  {e.phone && <span className="small muted">📞 {e.phone}</span>}
                </div>
                {e.specialisms.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {e.specialisms.map(s => (
                      <span key={s} style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", background: "var(--pink-light)", color: "var(--pink-dark)", fontWeight: 600 }}>{s}</span>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="btn"
                style={{ fontSize: "0.78rem", padding: "5px 10px", color: "#dc2626", flexShrink: 0 }}
                onClick={() => deactivate(e.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
