// app/customers/new/page.tsx
"use client";
import { useState } from "react";

export default function NewCustomerPage() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const f = new FormData(e.currentTarget);
    const toStr = (k: string) => (String(f.get(k) ?? "").trim());
    const toNull = (k: string) => {
      const v = toStr(k);
      return v === "" ? null : v;
    };
    const toIntNull = (k: string) => {
      const v = toStr(k);
      return v === "" ? null : Number(v);
    };

    const payload = {
      salonName: toStr("salonName"),
      customerName: toStr("customerName"),
      addressLine1: toStr("addressLine1"),
      addressLine2: toNull("addressLine2"),
      town: toNull("town"),
      county: toNull("county"),
      postCode: toNull("postCode"),
      daysOpen: toNull("daysOpen"),
      brandsInterestedIn: toNull("brandsInterestedIn"),
      notes: toNull("notes"),
      salesRep: toNull("salesRep"),
      customerNumber: toNull("customerNumber"),
      customerEmailAddress: toNull("customerEmailAddress"),
      openingHours: toNull("openingHours"),
      numberOfChairs: toIntNull("numberOfChairs"),
    };

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Failed to save (HTTP ${res.status})`);
      }

      const created = await res.json();
      window.location.href = `/customers/${created.id}`;
    } catch (err: any) {
      setError(err?.message || "Failed to save");
      setSaving(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <h2>New Customer</h2>

        {error && (
          <div className="card" style={{ borderColor: "#8b0000", background: "#2a1b1b", marginTop: 8 }}>
            <b>Couldn’t save</b>
            <div className="small" style={{ marginTop: 4 }}>{error}</div>
          </div>
        )}

        <form onSubmit={onSubmit} className="grid grid-2" style={{ gap: 12, marginTop: 12 }}>
          <div><label>Salon Name *</label><input name="salonName" required /></div>
          <div><label>Customer Name *</label><input name="customerName" required /></div>

          <div><label>Address Line 1 *</label><input name="addressLine1" required /></div>
          <div><label>Address Line 2</label><input name="addressLine2" /></div>

          <div><label>Town</label><input name="town" /></div>
          <div><label>County</label><input name="county" /></div>

          <div><label>Post Code</label><input name="postCode" /></div>
          <div><label>Days Open</label><input name="daysOpen" placeholder="e.g. Mon–Sat" /></div>

          <div><label>Brands Interested in</label><input name="brandsInterestedIn" /></div>
          <div><label>Sales Rep</label><input name="salesRep" /></div>

          <div><label>Customer Number</label><input name="customerNumber" /></div>
          <div><label>Customer Email Address</label><input name="customerEmailAddress" type="email" /></div>

          <div><label>Opening Hours</label><input name="openingHours" placeholder="e.g. 9–5" /></div>
          <div><label>Number of Chairs</label><input name="numberOfChairs" type="number" min="0" /></div>

          <div className="grid" style={{ gridColumn: "1 / -1" }}>
            <label>Notes</label>
            <textarea name="notes" rows={4} />
          </div>

          <div className="row" style={{ gap: 8, gridColumn: "1 / -1" }}>
            <button className="primary" disabled={saving} type="submit">
              {saving ? "Saving…" : "Save"}
            </button>
            <a href="/customers" className="link">Cancel</a>
          </div>
        </form>
      </div>
    </div>
  );
}
