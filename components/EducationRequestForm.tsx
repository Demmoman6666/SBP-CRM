// components/EducationRequestForm.tsx
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
  "Permanent colour",
  "Semi-permanent hair colour",
  "Care Range",
  "Styling Range",
] as const;

export default function EducationRequestForm({ customer }: { customer: CustomerLite }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/settings/visible-stocked-brands", { cache: "no-store" });
        const j = await r.json().catch(() => []);
        setBrands(Array.isArray(j) ? j : []);
      } catch {
        setBrands([]);
      }
    })();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);

    // ensure at least one education type or brand chosen?
    // (optional guard — comment out if you don’t want it)
    const pickedTypes = fd.getAll("educationTypes");
    if (pickedTypes.length === 0) {
      setErr("Please choose at least one education type.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/education/requests", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to submit education request");
      }

      // On success, go to the list page
      window.location.href = "/education/requests?created=1";
    } catch (e: any) {
      setErr(e?.message || "Failed to submit education request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
      {/* Hidden: pass customerId if we have one */}
      <input type="hidden" name="customerId" value={customer?.id || ""} />

      <div className="grid grid-2">
        <div className="field">
          <label>Salon</label>
          <input name="salonName" defaultValue={customer?.salonName || ""} readOnly />
        </div>
        <div className="field">
          <label>Contact</label>
          <input name="customerName" defaultValue={customer?.customerName || ""} readOnly />
        </div>

        <div className="field">
          <label>Telephone</label>
          <input name="customerTelephone" defaultValue={customer?.customerTelephone || ""} readOnly />
        </div>
        <div className="field">
          <label>Email</label>
          <input name="customerEmailAddress" defaultValue={customer?.customerEmailAddress || ""} readOnly />
        </div>

        <div className="field">
          <label>Address</label>
          <input
            name="addressLine1"
            defaultValue={customer?.addressLine1 || ""}
            readOnly
          />
        </div>
        <div className="field">
          <label>Address 2</label>
          <input name="addressLine2" defaultValue={customer?.addressLine2 || ""} readOnly />
        </div>

        <div className="field">
          <label>Town</label>
          <input name="town" defaultValue={customer?.town || ""} readOnly />
        </div>
        <div className="field">
          <label>County</label>
          <input name="county" defaultValue={customer?.county || ""} readOnly />
        </div>

        <div className="field">
          <label>Postcode</label>
          <input name="postCode" defaultValue={customer?.postCode || ""} readOnly />
        </div>
        <div className="field">
          <label>Country</label>
          <input name="country" defaultValue={customer?.country || ""} readOnly />
        </div>
      </div>

      {/* Brands checkboxes */}
      <div className="field">
        <label>Brands (education required)</label>
        {brands.length === 0 ? (
          <div className="small muted">No stocked brands are enabled in Settings.</div>
        ) : (
          <div
            className="grid"
            style={{ gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
          >
            {brands.map((b) => (
              <label key={b.id} className="row" style={{ gap: 8, alignItems: "center" }}>
                {/* multiple values => FormData.getAll("brandNames") */}
                <input type="checkbox" name="brandNames" value={b.name} />
                {b.name}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Education types */}
      <div className="field">
        <label>What type of education is required?</label>
        <div className="grid" style={{ gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {EDU_TYPES.map((t) => (
            <label key={t} className="row" style={{ gap: 8, alignItems: "center" }}>
              <input type="checkbox" name="educationTypes" value={t} />
              {t}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Notes (optional)</label>
        <textarea name="notes" rows={4} placeholder="Anything specific the educator should know?" />
      </div>

      {err && <div className="form-error">{err}</div>}

      <div className="right">
        <button className="primary" type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit Request"}
        </button>
      </div>
    </form>
  );
}
