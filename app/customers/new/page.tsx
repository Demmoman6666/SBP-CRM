// app/customers/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import OpeningHoursEditor from "@/components/OpeningHoursEditor";

/* ----------------------- tiny safe fetch helper ----------------------- */
async function safeGetArray<T = any>(url: string): Promise<T[]> {
  try {
    const r = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? (j as T[]) : [];
  } catch (e) {
    console.error(`[fetch] ${url} failed`, e);
    return [];
  }
}

/* ------------------------------- types ------------------------------- */
type Rep   = { id: string; name: string };
type Brand = { id: string; name: string };
/** Compact list of common countries (ISO-2 code + display name) */
const COUNTRIES = [
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "CH", name: "Switzerland" },
  { code: "AT", name: "Austria" },
  { code: "PT", name: "Portugal" },
  { code: "PL", name: "Poland" },
];

export default function NewCustomerPage() {
  /* data sources */
  const [reps, setReps] = useState<Rep[]>([]);
  const [competitorBrands, setCompetitorBrands] = useState<Brand[]>([]);
  const [brandsUsed, setBrandsUsed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [repsArr, compArr] = await Promise.all([
        safeGetArray<Rep>("/api/sales-reps"),
        safeGetArray<Brand>("/api/settings/visible-competitor-brands"),
      ]);
      if (!cancelled) {
        setReps(repsArr);
        setCompetitorBrands(compArr);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function toggleBrand(name: string) {
    setBrandsUsed(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  }

    return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Create Customer</h1>
      </section>

      <form method="POST" action="/api/customers" className="card grid" style={{ gap: 16 }}>
        {/* hidden aggregates */}
        <input type="hidden" name="brandsInterestedIn" value={brandsUsed.join(", ")} />

        {/* MOBILE-FIRST ORDER */}
        <div className="grid grid-2">
          {/* 1) Customer name */}
          <div className="field">
            <label>Customer Name*</label>
            <input
              name="customerName"
              required
              placeholder="Main contact"
              autoComplete="name"
            />
          </div>

          {/* 2) Salon name */}
          <div className="field">
            <label>Salon Name*</label>
            <input
              name="salonName"
              required
              placeholder="Salon Ltd"
              autoComplete="organization"
            />
          </div>

          {/* 3) Address line 1 */}
          <div className="field">
            <label>Address Line 1*</label>
            <input name="addressLine1" required autoComplete="address-line1" />
          </div>

          {/* 4) Address line 2 */}
          <div className="field">
            <label>Address Line 2</label>
            <input name="addressLine2" autoComplete="address-line2" />
          </div>

          {/* 5) Town */}
          <div className="field">
            <label>Town*</label>
            <input name="town" required autoComplete="address-level2" />
          </div>

          {/* 6) County */}
          <div className="field">
            <label>County*</label>
            <input name="county" required />
          </div>

          {/* 7) Postcode */}
          <div className="field">
            <label>Postcode*</label>
            <input name="postCode" required autoComplete="postal-code" />
          </div>

          {/* 8) Country */}
          <div className="field">
            <label>Country*</label>
            <select name="country" defaultValue="GB" required>
              {COUNTRIES.map(c => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* 9) Phone */}
          <div className="field">
            <label>Customer Telephone Number</label>
            <input
              name="customerTelephone"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+44 7…"
            />
          </div>

          {/* 10) Email */}
          <div className="field">
            <label>Customer Email Address</label>
            <input
              name="customerEmailAddress"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
            />
          </div>

          {/* 11) Sales rep */}
          <div className="field">
            <label>Sales Rep*</label>
            <select name="salesRep" required defaultValue="">
              <option value="" disabled>— Select a rep —</option>
              {(reps ?? []).map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
            <div className="form-hint">Required</div>
          </div>

          {/* 12) Customer stage */}
          <div className="field">
            <label>Customer Stage</label>
            <select name="stage" defaultValue="LEAD">
              <option value="LEAD">Lead</option>
              <option value="APPOINTMENT_BOOKED">Appointment booked</option>
              <option value="SAMPLING">Sampling</option>
              <option value="CUSTOMER">Customer</option>
            </select>
            <div className="form-hint">Optional – defaults to Lead.</div>
          </div>

          {/* 13) Number of chairs */}
          <div className="field">
            <label>Number of Chairs</label>
            <input name="numberOfChairs" type="number" min={0} inputMode="numeric" />
          </div>

          {/* 14) Brands used (checkboxes) */}
          <div className="field">
            <label>Brands Used</label>
            {competitorBrands.length === 0 ? (
              <div className="small muted">No competitor brands configured.</div>
            ) : (
              <div
                className="grid"
                style={{ gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
              >
                {competitorBrands.map(b => {
                  const checked = brandsUsed.includes(b.name);
                  return (
                    <label key={b.id} className="row" style={{ gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleBrand(b.name)}
                      />
                      <span>{b.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="form-hint">Pick all brands the salon currently uses.</div>
          </div>
        </div>

        {/* Opening hours */}
        <div className="field">
          <label>Opening Hours</label>
          <OpeningHoursEditor initialJSON="" />
        </div>

        {/* Notes */}
        <div className="field">
          <label>Notes</label>
          <textarea name="notes" rows={4} placeholder="Anything useful…" />
        </div>

        <div
          className="right"
          style={{
            position: "sticky",
            bottom: 0,
            background: "#fff",
            padding: "12px 0",
            borderTop: "1px solid var(--border)",
            zIndex: 10,
          }}
        >
          <button className="primary" type="submit" style={{ width: "100%", maxWidth: 320 }}>Create Customer</button>
        </div>
      </form>
    </div>
  );
}
