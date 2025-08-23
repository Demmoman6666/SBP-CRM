// app/customers/new/page.tsx
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import OpeningHoursFieldset from "@/components/OpeningHours";

export default async function NewCustomerPage() {
  // Load options for dropdowns
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
      salonName: s("salonName")!,            // required
      customerName: s("customerName")!,      // required
      addressLine1: s("addressLine1")!,      // required
      addressLine2: s("addressLine2"),
      town: s("town"),
      county: s("county"),
      postCode: s("postCode"),
      daysOpen: s("daysOpen"),
      brandsInterestedIn: s("brandsInterestedIn"), // dropdown (single)
      notes: s("notes"),
      salesRep: s("salesRep"),               // dropdown (single)
      customerNumber: s("customerNumber"),
      customerEmailAddress: s("customerEmailAddress"),
      openingHours: s("openingHoursJson"),   // <-- JSON string from OpeningHoursFieldset
      numberOfChairs: toInt("numberOfChairs"),
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
      <form action={createCustomer} className="grid" style={{ gap: 12 }}>
        <div className="grid grid-2">
          <div><label>Salon Name*</label><input name="salonName" required /></div>
          <div><label>Customer Name*</label><input name="customerName" required /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Address Line 1*</label><input name="addressLine1" required /></div>
          <div><label>Address Line 2</label><input name="addressLine2" /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Town</label><input name="town" /></div>
          <div><label>County</label><input name="county" /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Post Code</label><input name="postCode" /></div>
          <div><label>Days Open</label><input name="daysOpen" placeholder="e.g. Mon–Sat" /></div>
        </div>

        <div className="grid grid-2">
          <div>
            <label>Brands Interested in</label>
            <select name="brandsInterestedIn" defaultValue="">
              <option value="">Select a brand</option>
              {brands.map(b => (
                <option key={b.id} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Sales Rep</label>
            <select name="salesRep" defaultValue="">
              <option value="">Select a rep</option>
              {salesReps.map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid">
          <label>Opening Hours</label>
          <OpeningHoursFieldset />
          <span className="form-hint">Tick a day to enter opening and closing times.</span>
        </div>

        <div className="grid grid-2">
          <div><label>Customer Number</label><input name="customerNumber" /></div>
          <div><label>Customer Email Address</label><input type="email" name="customerEmailAddress" /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Number of Chairs</label><input type="number" name="numberOfChairs" min={0} /></div>
          <div><label>Notes</label><textarea name="notes" rows={4} placeholder="Anything useful..." /></div>
        </div>

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="reset">Reset</button>
          <button className="primary" type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}
