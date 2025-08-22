"use client";

import { useState } from "react";

type FormState = Record<string, string | number | undefined>;

export default function NewCustomerPage() {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    const form = new FormData(e.currentTarget);
    const payload: FormState = {};
    form.forEach((v, k) => (payload[k] = v.toString() || undefined));
    ["daysOpen", "numberOfChairs"].forEach((k) => {
      if (payload[k] !== undefined && payload[k] !== "") payload[k] = Number(payload[k]);
      else delete payload[k];
    });

    const res = await fetch("/api/customers", { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok) {
      setMsg("Failed to save");
    } else {
      const c = await res.json();
      window.location.href = `/customers/${c.id}`;
    }
    setSaving(false);
  }

  return (
    <div className="card">
      <h2>Create Customer</h2>
      <form className="grid" style={{ gap: 12 }} onSubmit={handleSubmit}>
        <div className="grid grid-2">
          <div><label>Salon Name</label><input name="salonName" required /></div>
          <div><label>Customer Name</label><input name="customerName" required /></div>
        </div>
        <div className="grid grid-2">
          <div><label>Address Line 1</label><input name="address1" /></div>
          <div><label>Address Line 2</label><input name="address2" /></div>
        </div>
        <div className="grid grid-2">
          <div><label>Town</label><input name="town" /></div>
          <div><label>County</label><input name="county" /></div>
        </div>
        <div className="grid grid-2">
          <div><label>Post Code</label><input name="postCode" /></div>
          <div><label>Days Open</label><input type="number" min="0" name="daysOpen" /></div>
        </div>
        <div className="grid grid-2">
          <div><label>Brands Interested in</label><input name="brandsInterestedIn" /></div>
          <div><label>Sales Rep</label><input name="salesRep" /></div>
        </div>
        <div className="grid grid-2">
          <div><label>Customer Number</label><input name="customerNumber" /></div>
          <div><label>Customer Email Address</label><input type="email" name="email" /></div>
        </div>
        <div className="grid grid-2">
          <div><label>Opening Hours</label><input name="openingHours" /></div>
          <div><label>Number of Chairs</label><input type="number" min="0" name="numberOfChairs" /></div>
        </div>
        <div>
          <label>Notes</label>
          <textarea name="notes" rows={4} placeholder="Anything useful..." />
        </div>

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 6, gap: 8 }}>
          <button className="ghost" type="reset">Reset</button>
          <button className="primary" disabled={saving}>{saving ? "Saving..." : "Create"}</button>
        </div>
        {msg && <p className="small">{msg}</p>}
      </form>
    </div>
  );
}
