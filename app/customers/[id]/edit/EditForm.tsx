// app/customers/[id]/edit/EditForm.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

type Rep = { id: string; name: string };
type Brand = { id: string; name: string };

type Initial = {
  salonName: string;
  customerName: string;
  addressLine1: string;
  addressLine2?: string;
  town?: string;
  county?: string;
  postCode?: string;
  customerTelephone?: string;
  customerEmailAddress?: string;
  brandsInterestedIn?: string;   // stores brand name
  salesRep: string;              // stores rep name (your schema)
  numberOfChairs?: number;
  notes?: string;
};

export default function EditForm({
  id,
  initial,
  reps,
  brands,
}: {
  id: string;
  initial: Initial;
  reps: Rep[];
  brands: Brand[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<Initial>(initial);
  const [saving, setSaving] = useState(false);

  const onChange =
    (key: keyof Initial) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const v = e.target.value;
      setForm((f) => ({
        ...f,
        [key]:
          key === "numberOfChairs"
            ? (v === "" ? undefined : Number(v))
            : v,
      }));
    };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.salesRep.trim()) {
      alert("Sales Rep is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || "Failed to save.");
      }
      router.push(`/customers/${id}`);
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-2" style={{ gap: 16 }}>
      {/* left column */}
      <div className="grid" style={{ gap: 12 }}>
        <div>
          <label>Salon Name*</label>
          <input
            required
            placeholder="Salon Ltd"
            value={form.salonName}
            onChange={onChange("salonName")}
          />
        </div>

        <div>
          <label>Address Line 1*</label>
          <input
            required
            value={form.addressLine1}
            onChange={onChange("addressLine1")}
          />
        </div>

        <div>
          <label>Address Line 2</label>
          <input value={form.addressLine2 || ""} onChange={onChange("addressLine2")} />
        </div>

        <div>
          <label>Town</label>
          <input value={form.town || ""} onChange={onChange("town")} />
        </div>

        <div>
          <label>County</label>
          <input value={form.county || ""} onChange={onChange("county")} />
        </div>

        <div>
          <label>Postcode</label>
          <input value={form.postCode || ""} onChange={onChange("postCode")} />
        </div>

        <div>
          <label>Notes</label>
          <textarea rows={6} value={form.notes || ""} onChange={onChange("notes")} />
        </div>
      </div>

      {/* right column */}
      <div className="grid" style={{ gap: 12 }}>
        <div>
          <label>Customer Name*</label>
          <input
            required
            placeholder="Main contact"
            value={form.customerName}
            onChange={onChange("customerName")}
          />
        </div>

        <div>
          <label>Customer Telephone Number</label>
          <input
            value={form.customerTelephone || ""}
            onChange={onChange("customerTelephone")}
          />
        </div>

        <div>
          <label>Customer Email Address</label>
          <input
            type="email"
            placeholder="name@domain.com"
            value={form.customerEmailAddress || ""}
            onChange={onChange("customerEmailAddress")}
          />
        </div>

        {/* BRAND DROPDOWN */}
        <div>
          <label>Brands Used</label>
          <select
            value={form.brandsInterestedIn || ""}
            onChange={onChange("brandsInterestedIn")}
          >
            <option value="">— Select a brand —</option>
            {brands.map((b) => (
              <option key={b.id} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {/* SALES REP DROPDOWN (required) */}
        <div>
          <label>Sales Rep*</label>
          <select
            required
            value={form.salesRep}
            onChange={onChange("salesRep")}
          >
            <option value="">— Select a rep —</option>
            {reps.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
          {!form.salesRep && (
            <div className="form-hint">Required</div>
          )}
        </div>

        <div>
          <label>Number of Chairs</label>
          <input
            type="number"
            min={0}
            step={1}
            placeholder="e.g., 6"
            value={form.numberOfChairs ?? ""}
            onChange={onChange("numberOfChairs")}
          />
        </div>

        <div className="right" style={{ gap: 8, marginTop: 8 }}>
          <Link href={`/customers/${id}`} className="btn">Cancel</Link>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </form>
  );
}
