"use client";

import { useEffect, useState } from "react";

type CustomerLite = {
  id: string;
  salonName: string | null;
  customerName: string | null;
  customerTelephone: string | null;
  customerEmailAddress: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  town: string | null;
  county: string | null;
  postCode: string | null;
  country: string | null;
  salesRep: string | null;
} | null;

type Brand = { id: string; name: string };

const EDU_TYPES = [
  { value: "Permanent colour", label: "Permanent Colour", icon: "🎨" },
  { value: "Semi-permanent hair colour", label: "Semi-Permanent Colour", icon: "💜" },
  { value: "Care Range", label: "Care Range", icon: "✨" },
  { value: "Styling Range", label: "Styling Range", icon: "💁" },
] as const;

export default function EducationRequestForm({ customer }: { customer: CustomerLite }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/visible-stocked-brands", { cache: "no-store" })
      .then(r => r.json())
      .then(j => setBrands(Array.isArray(j) ? j : []))
      .catch(() => setBrands([]));
  }, []);

  function toggleBrand(name: string) {
    setSelectedBrands(prev => prev.includes(name) ? prev.filter(b => b !== name) : [...prev, name]);
  }

  function toggleType(val: string) {
    setSelectedTypes(prev => prev.includes(val) ? prev.filter(t => t !== val) : [...prev, val]);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (selectedTypes.length === 0) {
      setErr("Please choose at least one education type.");
      return;
    }
    if (selectedBrands.length === 0) {
      setErr("Please select at least one brand.");
      return;
    }

    const fd = new FormData(e.currentTarget);
    selectedBrands.forEach(b => fd.append("brandNames", b));
    selectedTypes.forEach(t => fd.append("educationTypes", t));

    try {
      setSubmitting(true);
      const res = await fetch("/api/education/requests", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to submit education request");
      }
      window.location.href = "/education?submitted=1";
    } catch (e: any) {
      setErr(e?.message || "Failed to submit education request");
    } finally {
      setSubmitting(false);
    }
  }

  if (!customer) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <p style={{ fontSize: "1.5rem", marginBottom: 8 }}>📚</p>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>No customer selected</p>
        <p className="small muted">Open a customer profile and click "Request Education" to get started.</p>
      </div>
    );
  }

  const address = [customer.addressLine1, customer.town, customer.postCode].filter(Boolean).join(", ");

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="customerId" value={customer.id || ""} />

      {/* Customer summary — not a form, just a visual confirmation */}
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px", marginBottom: 24 }}>
        <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 10 }}>Requesting education for</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1rem" }}>{customer.salonName || "Unknown Salon"}</div>
            {customer.customerName && <div className="small muted">{customer.customerName}</div>}
            {address && <div className="small muted">{address}</div>}
          </div>
          <div>
            {customer.customerTelephone && <div className="small muted">📞 {customer.customerTelephone}</div>}
            {customer.customerEmailAddress && <div className="small muted">✉ {customer.customerEmailAddress}</div>}
            {customer.salesRep && <div className="small muted">🧑‍💼 {customer.salesRep}</div>}
          </div>
        </div>
      </div>

      {/* Hidden fields to pass address details to API */}
      <input type="hidden" name="salonName" value={customer.salonName || ""} />
      <input type="hidden" name="customerName" value={customer.customerName || ""} />
      <input type="hidden" name="customerTelephone" value={customer.customerTelephone || ""} />
      <input type="hidden" name="customerEmailAddress" value={customer.customerEmailAddress || ""} />
      <input type="hidden" name="addressLine1" value={customer.addressLine1 || ""} />
      <input type="hidden" name="addressLine2" value={customer.addressLine2 || ""} />
      <input type="hidden" name="town" value={customer.town || ""} />
      <input type="hidden" name="county" value={customer.county || ""} />
      <input type="hidden" name="postCode" value={customer.postCode || ""} />
      <input type="hidden" name="country" value={customer.country || ""} />

      <div style={{ display: "grid", gap: 24 }}>
        {/* Brands */}
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Which brands require education?</div>
          <div className="small muted" style={{ marginBottom: 12 }}>Select all that apply.</div>
          {brands.length === 0 ? (
            <div className="small muted">No stocked brands are enabled in Settings.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              {brands.map(b => {
                const active = selectedBrands.includes(b.name);
                return (
                  <div
                    key={b.id}
                    onClick={() => toggleBrand(b.name)}
                    style={{ padding: "12px 14px", borderRadius: 10, cursor: "pointer", border: active ? "2px solid var(--pink)" : "1px solid var(--border)", background: active ? "var(--pink-light)" : "#fff", transition: "all 0.15s" }}
                  >
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", color: active ? "var(--pink-dark)" : "var(--text)" }}>{b.name}</div>
                    {active && <div style={{ fontSize: "0.75rem", color: "var(--pink-dark)", marginTop: 2 }}>✓ Selected</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Education types */}
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>What type of education is needed?</div>
          <div className="small muted" style={{ marginBottom: 12 }}>Select all that apply.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            {EDU_TYPES.map(t => {
              const active = selectedTypes.includes(t.value);
              return (
                <div
                  key={t.value}
                  onClick={() => toggleType(t.value)}
                  style={{ padding: "12px 14px", borderRadius: 10, cursor: "pointer", border: active ? "2px solid var(--pink)" : "1px solid var(--border)", background: active ? "var(--pink-light)" : "#fff", transition: "all 0.15s" }}
                >
                  <div style={{ fontSize: "1.2rem", marginBottom: 4 }}>{t.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem", color: active ? "var(--pink-dark)" : "var(--text)" }}>{t.label}</div>
                  {active && <div style={{ fontSize: "0.75rem", color: "var(--pink-dark)", marginTop: 2 }}>✓ Selected</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div className="field">
          <label>Notes for the educator <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span></label>
          <textarea name="notes" rows={4} placeholder="e.g. The salon has 6 chairs, mainly colour-focused clients. They've been sampling REF for 2 months and are interested in a full team training day..." />
        </div>

        {err && <div className="form-error">{err}</div>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 8, borderTop: "1px solid var(--border)" }}>
          <a href={customer.id ? "/customers/" + customer.id : "/education"} className="btn">Cancel</a>
          <button className="primary" type="submit" disabled={submitting || selectedBrands.length === 0 || selectedTypes.length === 0}>
            {submitting ? "Submitting..." : "Submit Education Request"}
          </button>
        </div>
      </div>
    </form>
  );
}
