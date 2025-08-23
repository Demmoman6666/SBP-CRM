// app/customers/new/page.tsx
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import OpeningHoursFieldset from "@/components/OpeningHours";

export default async function NewCustomerPage() {
  // Options for the dropdowns
  const [salesReps, brands] = await Promise.all([
    prisma.salesRep.findMany({ orderBy: { name: "asc" } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
  ]);

  async function createCustomer(formData: FormData) {
    "use server";

    const s = (name: string) =>
      (String(formData.get(name) ?? "").trim() || null) as string | null;

    const toInt = (name: string) => {
      const v = formData.get(name);
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const data = {
      // LEFT COLUMN
      salonName: s("salonName")!,            // required
      addressLine1: s("addressLine1")!,      // required
      addressLine2: s("addressLine2"),
      town: s("town"),
      county: s("county"),
      postCode: s("postCode"),
      customerNumber: s("contactNumber"),    // “Contact Number” → customerNumber
      numberOfChairs: toInt("numberOfChairs"),

      // RIGHT COLUMN
      customerName: s("customerName")!,      // required
      customerTelephone: s("customerTelephone"),
      customerEmailAddress: s("customerEmailAddress"),

      // BELOW COLUMNS
      brandsInterestedIn: s("brandsInterestedIn"),
      salesRep: s("salesRep"),

      // BOTTOM
      openingHours: s("openingHoursJson"),

      // Optional notes
      notes: s("notes"),
    };

    if (!data.salonName || !data.customerName || !data.addressLine1) {
      throw new Error("Salon Name, Customer Name and Address Line 1 are required.");
    }

    const created = await prisma.customer.create({ data });
    redirect(`/customers/${created.id}`);
  }

  return (
    <div className="card">
      <h2>Create Customer</h2>

      <form action={createCustomer} className="grid" style={{ gap: 16 }}>
        {/* Two column layout */}
        <div className="grid grid-2">
          {/* LEFT */}
          <div className="grid" style={{ gap: 12 }}>
            <div><label>Salon Name*</label><input name="salonName" required /></div>
            <div><label>Address Line 1*</label><input name="addressLine1" required /></div>
            <div><label>Address Line 2</label><input name="addressLine2" /></div>
            <div><label>Town</label><input name="town" /></div>
            <div><label>County</label><input name="county" /></div>
            <div><label>Post Code</label><input name="postCode" /></div>
            <div><label>Contact Number</label><input name="contactNumber" /></div>
            <div><label>Number of Chairs</label><input type="number" name="numberOfChairs" min={0} /></div>
          </div>

          {/* RIGHT */}
          <div className="grid" style={{ gap: 12 }}>
            <div><label>Customer Name*</label><input name="customerName" required /></div>
            <div><label>Customer Telephone Number</label><input name="customerTelephone" /></div>
            <div><label>Customer Email Address</label><input type="email" name="customerEmailAddress" /></div>
          </div>
        </div>

        {/* Keep these below the two columns */}
        <div className="grid grid-2">
          <div>
            <label>Brands Interested in</label>
            <select name="brandsInterestedIn" defaultValue="">
              <option value="">Select a brand</option>
              {brands.map((b) => (
                <option key={b.id} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Sales Rep</label>
            <select name="salesRep" defaultValue="">
              <option value="">Select a rep</option>
              {salesReps.map((r) => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Opening hours stays at the bottom */}
        <div className="grid">
          <label>Opening Hours</label>
          <OpeningHoursFieldset />
          <span className="form-hint">Tick a day to enter opening and closing times.</span>
        </div>

        {/* Notes (optional) */}
        <div>
          <label>Notes</label>
          <textarea name="notes" rows={4} placeholder="Anything useful..." />
        </div>

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="reset">Reset</button>
          <button className="primary" type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}
