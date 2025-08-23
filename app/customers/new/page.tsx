// app/customers/new/page.tsx
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export default async function NewCustomerPage() {
  const [reps, brands] = await Promise.all([
    prisma.salesRep.findMany({ orderBy: { name: "asc" } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
  ]);

  async function createCustomer(formData: FormData) {
    "use server";

    const s = (name: string) =>
      (String(formData.get(name) ?? "").trim() || null) as string | null;

    const toInt = (name: string) => {
      const v = String(formData.get(name) ?? "");
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    // Build opening hours JSON
    const opening: Record<string, { open: boolean; from?: string; to?: string }> =
      {};
    for (const d of DAYS) {
      const on = formData.get(`${d}-on`) === "on";
      const from = String(formData.get(`${d}-from`) ?? "");
      const to = String(formData.get(`${d}-to`) ?? "");
      opening[d] = { open: on, ...(on && from ? { from } : {}), ...(on && to ? { to } : {}) };
    }

    const data = {
      // left column
      salonName: s("salonName")!, // required
      addressLine1: s("addressLine1")!, // required
      addressLine2: s("addressLine2"),
      town: s("town"),
      county: s("county"),
      postCode: s("postCode"),
      customerNumber: s("contactNumber"), // maps "Contact Number" to existing schema field
      numberOfChairs: toInt("numberOfChairs"),

      // right column
      customerName: s("customerName")!, // required
      customerEmailAddress: s("customerEmailAddress"),

      // selects + notes + opening hours
      salesRep: s("salesRep"),
      brandsInterestedIn: s("brand"),
      notes: s("notes"),
      openingHours: JSON.stringify(opening),
    };

    // basic required checks
    if (!data.salonName || !data.addressLine1 || !data.customerName) {
      throw new Error("Salon Name, Address Line 1, and Customer Name are required.");
    }

    await prisma.customer.create({ data });
    redirect("/customers");
  }

  return (
    <div className="card">
      <h2>Create Customer</h2>

      <form action={createCustomer} className="grid" style={{ gap: 16 }}>
        {/* Two-column layout */}
        <div className="grid-2">
          {/* LEFT COLUMN */}
          <div className="grid" style={{ gap: 12 }}>
            <div className="field">
              <label>Salon Name*</label>
              <input name="salonName" required />
            </div>
            <div className="field">
              <label>Address Line 1*</label>
              <input name="addressLine1" required />
            </div>
            <div className="field">
              <label>Address Line 2</label>
              <input name="addressLine2" />
            </div>
            <div className="field">
              <label>Town</label>
              <input name="town" />
            </div>
            <div className="field">
              <label>County</label>
              <input name="county" />
            </div>
            <div className="field">
              <label>Postcode</label>
              <input name="postCode" />
            </div>
            <div className="field">
              <label>Contact Number</label>
              <input name="contactNumber" />
            </div>
            <div className="field">
              <label>Number of Chairs</label>
              <input type="number" name="numberOfChairs" min={0} />
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="grid" style={{ gap: 12 }}>
            <div className="field">
              <label>Customer Name*</label>
              <input name="customerName" required />
            </div>
            <div className="field">
              <label>Customer Telephone Number</label>
              {/* NOTE: not stored separately in current schema.
                  If you want this persisted, we can add a field. */}
              <input name="customerTelephone" />
            </div>
            <div className="field">
              <label>Customer Email Address</label>
              <input type="email" name="customerEmailAddress" />
            </div>
          </div>
        </div>

        {/* Selects */}
        <div className="grid-2">
          <div className="field">
            <label>Brands Interested in</label>
            <select name="brand" defaultValue="">
              <option value="" disabled>
                Select a brand
              </option>
              {brands.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Sales Rep</label>
            <select name="salesRep" defaultValue="">
              <option value="" disabled>
                Select a rep
              </option>
              {reps.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Opening Hours */}
        <div className="field">
          <label>Opening Hours</label>
          <div className="card" style={{ padding: 12 }}>
            {DAYS.map((d) => (
              <div
                key={d}
                className="row"
                style={{ alignItems: "center", gap: 12, padding: "6px 0" }}
              >
                <label className="row" style={{ alignItems: "center", gap: 8, width: 90 }}>
                  <input type="checkbox" name={`${d}-on`} />
                  <span className="small">{d}</span>
                </label>
                <span className="small" style={{ width: 36 }}>
                  Open
                </span>
                <input type="time" name={`${d}-from`} style={{ maxWidth: 140 }} />
                <span className="small" style={{ width: 40, textAlign: "center" }}>
                  Close
                </span>
                <input type="time" name={`${d}-to`} style={{ maxWidth: 140 }} />
              </div>
            ))}
            <div className="small muted" style={{ marginTop: 6 }}>
              Tick a day to enter opening and closing times.
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="field">
          <label>Notes</label>
          <textarea name="notes" rows={4} placeholder="Anything useful..." />
        </div>

        <div className="right" style={{ gap: 8 }}>
          <button type="reset">Reset</button>
          <button className="primary" type="submit">
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
