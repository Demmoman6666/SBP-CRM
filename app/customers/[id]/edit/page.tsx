// app/customers/[id]/edit/page.tsx
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({
  params,
}: {
  params: { id: string };
}) {
  const [customer, reps] = await Promise.all([
    prisma.customer.findUnique({ where: { id: params.id } }),
    prisma.salesRep.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!customer) return <div className="card">Not found.</div>;

  const repNames = reps.map((r) => r.name);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <h2>Edit Customer</h2>
          <Link href={`/customers/${customer.id}`} className="small">
            ← Back
          </Link>
        </div>
      </div>

      <EditForm initial={customer} repNames={repNames} />
    </div>
  );
}

/** Client form */
"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

function EditForm({
  initial,
  repNames,
}: {
  initial: any;
  repNames: string[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    salonName: initial.salonName ?? "",
    customerName: initial.customerName ?? "",
    addressLine1: initial.addressLine1 ?? "",
    addressLine2: initial.addressLine2 ?? "",
    town: initial.town ?? "",
    county: initial.county ?? "",
    postCode: initial.postCode ?? "",
    customerTelephone: initial.customerTelephone ?? "",
    customerEmailAddress: initial.customerEmailAddress ?? "",
    brandsInterestedIn: initial.brandsInterestedIn ?? "",
    salesRep: initial.salesRep ?? "",
    numberOfChairs: initial.numberOfChairs ?? "",
    notes: initial.notes ?? "",
  });

  const canSave = useMemo(() => {
    return (
      form.salonName.trim() &&
      form.customerName.trim() &&
      form.addressLine1.trim() &&
      form.salesRep.trim()
    );
  }, [form]);

  function update<K extends keyof typeof form>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      router.push(`/customers/${initial.id}`);
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Save failed");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card grid" style={{ gap: 12 }}>
      <div className="grid grid-2">
        <div className="field">
          <label>Salon Name*</label>
          <input
            value={form.salonName}
            onChange={(e) => update("salonName", e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Customer Name*</label>
          <input
            value={form.customerName}
            onChange={(e) => update("customerName", e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label>Address Line 1*</label>
          <input
            value={form.addressLine1}
            onChange={(e) => update("addressLine1", e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Address Line 2</label>
          <input
            value={form.addressLine2}
            onChange={(e) => update("addressLine2", e.target.value)}
          />
        </div>

        <div className="field">
          <label>Town</label>
          <input value={form.town} onChange={(e) => update("town", e.target.value)} />
        </div>
        <div className="field">
          <label>County</label>
          <input
            value={form.county}
            onChange={(e) => update("county", e.target.value)}
          />
        </div>

        <div className="field">
          <label>Postcode</label>
          <input
            value={form.postCode}
            onChange={(e) => update("postCode", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Brands Used</label>
          <input
            value={form.brandsInterestedIn}
            onChange={(e) => update("brandsInterestedIn", e.target.value)}
            placeholder="e.g. Wella"
          />
        </div>

        <div className="field">
          <label>Customer Telephone Number</label>
          <input
            value={form.customerTelephone}
            onChange={(e) => update("customerTelephone", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Customer Email Address</label>
          <input
            type="email"
            value={form.customerEmailAddress}
            onChange={(e) => update("customerEmailAddress", e.target.value)}
          />
        </div>

        <div className="field">
          <label>Sales Rep*</label>
          <select
            value={form.salesRep}
            onChange={(e) => update("salesRep", e.target.value)}
            required
          >
            <option value="">— Select a rep —</option>
            {repNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {!form.salesRep && (
            <div className="form-hint">Required</div>
          )}
        </div>

        <div className="field">
          <label>Number of Chairs</label>
          <input
            type="number"
            inputMode="numeric"
            value={form.numberOfChairs as any}
            onChange={(e) => update("numberOfChairs", e.target.value)}
            min={0}
          />
        </div>
      </div>

      <div className="field">
        <label>Profile Notes</label>
        <textarea
          rows={4}
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
        />
      </div>

      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <Link
          href={`/customers/${initial.id}`}
          className="btn"
          style={{
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 12px",
          }}
        >
          Cancel
        </Link>
        <button className="primary" type="submit" disabled={!canSave || saving}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
