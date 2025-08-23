// app/customers/new/page.tsx
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

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
      const v = formData.get(name);
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const selectedBrands = formData.getAll("brands").map(v => String(v)).filter(Boolean);

    const data = {
      salonName: s("salonName")!,            // required
      customerName: s("customerName")!,      // required
      addressLine1: s("addressLine1")!,      // required
      addressLine2: s("addressLine2"),
      town: s("town"),
      county: s("county"),
      postCode: s("postCode"),
      daysOpen: s("daysOpen"),
      brandsInterestedIn: selectedBrands.length ? selectedBrands.join(", ") : s("brandsInterestedIn"),
      notes: s("notes"),
      salesRep: s("salesRep"),               // stores selected rep name
      customerNumber: s("customerNumber"),
      customerEmailAddress: s("customerEmailAddress"),
      openingHours: s("openingHours"),
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
            <label>Sales Rep</label>
            <select name="salesRep" defaultValue="">
              <option value="">— Select a rep —</option>
              {reps.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label>Brands Interested in</label>
            {/* Multi-select using checkboxes; values will join into a string */}
            <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              {brands.map(b => (
                <label key={b.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" name="brands" value={b.name} />
                  <span>{b.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-2">
          <div><label>Customer Number</label><input name="customerNumber" /></div>
          <div><label>Customer Email Address</label><input type="email" name="customerEmailAddress" /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Opening Hours</label><input name="openingHours" placeholder="e.g. 9–5 Mon–Sat" /></div>
          <div><label>Number of Chairs</label><input type="number" name="numberOfChairs" min={0} /></div>
        </div>

        <div><label>Notes</label><textarea name="notes" rows={4} placeholder="Anything useful..." /></div>

        <div className="right" style={{ gap: 8 }}>
          <button type="reset">Reset</button>
          <button className="primary" type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}
