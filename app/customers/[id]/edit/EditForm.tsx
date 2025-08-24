// app/customers/[id]/edit/EditForm.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Customer = {
  id: string;
  salonName: string;
  customerName: string;
  addressLine1: string;
  addressLine2?: string | null;
  town?: string | null;
  county?: string | null;
  postCode?: string | null;
  brandsInterestedIn?: string | null;
  notes?: string | null;
  salesRep?: string | null;
  customerNumber?: string | null;
  customerTelephone?: string | null;
  customerEmailAddress?: string | null;
  openingHours?: string | null;
  numberOfChairs?: number | null;
};

type Props = { id: string; initial: Customer };

export default function EditForm({ id, initial }: Props) {
  const router = useRouter();

  const [form, setForm] = useState<Customer>(initial);
  const [reps, setReps] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/sales-reps")
      .then((r) => r.json())
      .then((data) => setReps(Array.isArray(data) ? data : []))
      .catch(() => setReps([]));
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const canSave = useMemo(() => {
    return (
      (form.salonName || "").trim() &&
      (form.customerName || "").trim() &&
      (form.addressLine1 || "").trim() &&
      (form.salesRep || "").trim()
    );
  }, [form]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) {
      alert("Please complete the required fields.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      router.push(`/customers/${id}`);
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Failed to update customer.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card grid" style={{ gap: 12 }}>
      <div className="grid grid-2">
        <div>
          <label>Salon Name*</label>
          <input name="salonName" value={form.salonName || ""} onChange={onChange} required />
        </div>
        <div>
          <label>Customer Name*</label>
          <input name="customerName" value={form.customerName || ""} onChange={onChange} required />
        </div>

        <div>
          <label>Address Line 1*</label>
          <input name="addressLine1" value={form.addressLine1 || ""} onChange={onChange} required />
        </div>
        <div>
          <label>Customer Telephone Number</label>
          <input name="customerTelephone" value={form.customerTelephone || ""} onChange={onChange} />
        </div>

        <div>
          <label>Address Line 2</label>
          <input name="addressLine2" value={form.addressLine2 || ""} onChange={onChange} />
        </div>
        <div>
          <label>Customer Email Address</label>
          <input name="customerEmailAddress" type="email" value={form.customerEmailAddress || ""} onChange={onChange} />
        </div>

        <div>
          <label>Town</label>
          <input name="town" value={form.town || ""} onChange={onChange} />
        </div>
        <div>
          <label>Brands Used</label>
          <input name="brandsInterestedIn" value={form.brandsInterestedIn || ""} onChange={onChange} />
        </div>

        <div>
          <label>County</label>
          <input name="county" value={form.county || ""} onChange={onChange} />
        </div>
        <div>
          <label>Sales Rep*</label>
          <select name="salesRep" value={form.salesRep || ""} onChange={onChange} required>
            <option value="">— Select a rep —</option>
            {reps.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Postcode</label>
          <input name="postCode" value={form.postCode || ""} onChange={onChange} />
        </div>
        <div>
          <label>Number of Chairs</label>
          <input
            name="numberOfChairs"
            type="number"
            value={form.numberOfChairs ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, numberOfChairs: e.target.value === "" ? null : Number(e.target.value) }))
            }
          />
        </div>
      </div>

      <div>
        <label>Notes</label>
        <textarea name="notes" rows={4} value={form.notes || ""} onChange={onChange} />
      </div>

      <div className="right" style={{ gap: 8 }}>
        <button type="button" className="btn" onClick={() => router.push(`/customers/${id}`)}>
          Cancel
        </button>
        <button className="primary" type="submit" disabled={saving || !canSave}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
