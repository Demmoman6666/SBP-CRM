// app/customers/[id]/edit/EditForm.tsx
"use client";

import { useMemo, useState } from "react";
import OpeningHoursEditor from "@/components/OpeningHoursEditor";

type Rep = { id: string; name: string };
type Brand = { id: string; name: string };

type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
type DayState = {
  enabled: boolean;
  openH: string;
  openM: string;
  closeH: string;
  closeM: string;
};

const DAYS: DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const makeDefaultDay = (): DayState => ({
  enabled: false,
  openH: "09",
  openM: "00",
  closeH: "17",
  closeM: "00",
});

// A small, fixed list keeps UX tight and avoids an async call.
const COUNTRIES = [
  "United Kingdom",
  "Ireland",
  "France",
  "Germany",
  "Spain",
  "Italy",
  "United States",
  "Canada",
  "Australia",
  "New Zealand",
];


type EditFormProps = {
  id: string;
  initial: {
    salonName: string;
    customerName: string;
    addressLine1: string;
    addressLine2?: string | null;
    town?: string | null;
    county?: string | null;
    postCode?: string | null;
    country?: string | null;                 // ← NEW
    customerTelephone?: string | null;
    customerEmailAddress?: string | null;
    brandsInterestedIn?: string | null;
    salesRep?: string | null;
    numberOfChairs?: number | undefined;
    notes?: string | null;
    openingHours?: string | null;            // ← NEW
  };
  reps: Rep[];
  brands: Brand[];
};

export default function EditForm({ id, initial, reps, brands }: EditFormProps) {
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    const res = await fetch(`/api/customers/${id}`, {
      method: "PATCH",
      body: fd,
    });

    if (res.ok) {
      // go back to the customer details page
      window.location.href = `/customers/${id}`;
    } else {
      const text = await res.text().catch(() => "");
      alert(`Update failed: ${res.status}\n${text}`);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid" style={{ gap: 16 }}>
      <div className="grid grid-2">
        <div className="field">
          <label>Salon Name*</label>
          <input name="salonName" required defaultValue={initial.salonName} />
        </div>
        <div className="field">
          <label>Customer Name*</label>
          <input name="customerName" required defaultValue={initial.customerName} />
        </div>

        <div className="field">
          <label>Address Line 1*</label>
          <input name="addressLine1" required defaultValue={initial.addressLine1} />
        </div>
        <div className="field">
          <label>Customer Telephone Number</label>
          <input name="customerTelephone" defaultValue={initial.customerTelephone ?? ""} />
        </div>

        <div className="field">
          <label>Address Line 2</label>
          <input name="addressLine2" defaultValue={initial.addressLine2 ?? ""} />
        </div>
        <div className="field">
          <label>Customer Email Address</label>
          <input name="customerEmailAddress" type="email" defaultValue={initial.customerEmailAddress ?? ""} />
        </div>

        <div className="field">
          <label>Town</label>
          <input name="town" defaultValue={initial.town ?? ""} />
        </div>
        <div className="field">
          <label>Brands Used</label>
          <select name="brandsInterestedIn" defaultValue={initial.brandsInterestedIn ?? ""}>
            <option value="">— Select a brand —</option>
            {brands.map((b) => (
              <option key={b.id} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>County</label>
          <input name="county" defaultValue={initial.county ?? ""} />
        </div>
        <div className="field">
          <label>Sales Rep*</label>
          <select name="salesRep" required defaultValue={initial.salesRep ?? ""}>
            <option value="" disabled>
              — Select a rep —
            </option>
            {reps.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
          <div className="form-hint">Required</div>
        </div>

        <div className="field">
          <label>Postcode</label>
          <input name="postCode" defaultValue={initial.postCode ?? ""} />
        </div>
        <div className="field">
          <label>Country</label>
          <select name="country" defaultValue={initial.country ?? ""}>
            <option value="">— Select a country —</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Number of Chairs</label>
          <input
            name="numberOfChairs"
            type="number"
            min={0}
            defaultValue={initial.numberOfChairs ?? undefined}
            placeholder="e.g., 6"
          />
        </div>
      </div>

      {/* Opening Hours block */}
      <OpeningHoursEditor initialJSON={initial.openingHours ?? ""} />

      <div className="field">
        <label>Notes</label>
        <textarea name="notes" rows={4} defaultValue={initial.notes ?? ""} />
      </div>

      <div className="right row" style={{ gap: 8 }}>
        <a className="button" href={`/customers/${id}`}>Cancel</a>
        <button className="primary" type="submit">Save Changes</button>
      </div>
    </form>
  );
}
