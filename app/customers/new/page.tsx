// app/customers/new/page.tsx
"use client";

import { useEffect, useState } from "react";

type Rep = { id: string; name: string };

export default function NewCustomerPage() {
  const [reps, setReps] = useState<Rep[]>([]);
  useEffect(() => {
    fetch("/api/sales-reps")
      .then(r => r.json())
      .then(setReps)
      .catch(() => setReps([]));
  }, []);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Create Customer</h1>
      </section>

      <form method="POST" action="/api/customers" className="card grid" style={{ gap: 12 }}>
        <div className="grid grid-2">
          <div className="field">
            <label>Salon Name*</label>
            <input name="salonName" required placeholder="Salon Ltd" />
          </div>
          <div className="field">
            <label>Customer Name*</label>
            <input name="customerName" required placeholder="Main contact" />
          </div>

          <div className="field">
            <label>Address Line 1*</label>
            <input name="addressLine1" required />
          </div>
          <div className="field">
            <label>Customer Telephone Number</label>
            <input name="customerTelephone" />
          </div>

          <div className="field">
            <label>Address Line 2</label>
            <input name="addressLine2" />
          </div>
          <div className="field">
            <label>Customer Email Address</label>
            <input name="customerEmailAddress" type="email" />
          </div>

          <div className="field">
            <label>Town</label>
            <input name="town" />
          </div>
          <div className="field">
            <label>Brands Used</label>
            <input name="brandsInterestedIn" placeholder="e.g. Wella" />
          </div>

          <div className="field">
            <label>County</label>
            <input name="county" />
          </div>
          <div className="field">
            <label>Sales Rep*</label>
            <select name="salesRep" required defaultValue="">
              <option value="" disabled>— Select a rep —</option>
              {reps.map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
            <div className="form-hint">Required</div>
          </div>

          <div className="field">
            <label>Postcode</label>
            <input name="postCode" />
          </div>
          <div className="field">
            <label>Number of Chairs</label>
            <input name="numberOfChairs" type="number" min={0} />
          </div>
        </div>

        <div className="field">
          <label>Notes</label>
          <textarea name="notes" rows={4} placeholder="Anything useful…" />
        </div>

        <div className="right">
          <button className="primary" type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}
