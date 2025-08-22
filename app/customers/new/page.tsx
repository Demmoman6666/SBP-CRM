// app/customers/new/page.tsx
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export default function NewCustomerPage() {
  async function createCustomer(formData: FormData) {
    "use server";

    const numberOrNull = (v: FormDataEntryValue | null) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const str = (name: string) => String(formData.get(name) ?? "").trim() || null;

    // Map EXACTLY to prisma/schema.prisma fields
    const data = {
      salonName: str("salonName")!,            // required
      customerName: str("customerName")!,      // required
      addressLine1: str("addressLine1")!,      // required
      addressLine2: str("addressLine2"),
      town: str("town"),
      county: str("county"),
      postCode: str("postCode"),
      daysOpen: str("daysOpen"),
      brandsInterestedIn: str("brandsInterestedIn"),
      notes: str("notes"),
      salesRep: str("salesRep"),
      customerNumber: str("customerNumber"),
      customerEmailAddress: str("customerEmailAddress"),
      openingHours: str("openingHours"),
      numberOfChairs: numberOrNull(formData.get("numberOfChairs")),
    };

    // Minimal required validation
    if (!data.salonName || !data.customerName || !data.addressLine1) {
      throw new Error("Salon Name, Customer Name and Address Line 1 are required.");
    }

    const created = await prisma.customer.create({ data });
    redirect(`/customers/${created.id}`);
  }

  return (
    <div className="card">
      <h2>New Customer</h2>
      <form action={createCustomer} className="grid" style={{ gap: 10 }}>
        <div className="grid grid-2">
          <div><label>Salon Name*</label><input name="salonName" required /></div>
          <div><label>Customer Name*</label><input name="customerName" required /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Address Line 1*</label><input name="addressLine1" required /></div>
          <div><label>Address Line 2</label><input name="addressLine2" /></div>
        </div>

        <div className="grid grid-3">
          <div><label>Town</label><input name="town" /></div>
          <div><label>County</label><input name="county" /></div>
          <div><label>Post Code</label><input name="postCode" /></div>
        </div>

        <div className="grid grid-3">
          <div><label>Days Open</label><input name="daysOpen" placeholder="e.g. Mon–Sat" /></div>
          <div><label>Number of Chairs</label><input name="numberOfChairs" type="number" min={0} /></div>
          <div><label>Sales Rep</label><input name="salesRep" /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Customer Number</label><input name="customerNumber" /></div>
          <div><label>Customer Email Address</label><input type="email" name="customerEmailAddress" /></div>
        </div>

        <div><label>Opening Hours</label><input name="openingHours" placeholder="e.g. 9–5 Mon–Sat" /></div>
        <div><label>Brands Interested in</label><input name="brandsInterestedIn" placeholder="Comma separated" /></div>
        <div><label>Notes</label><textarea name="notes" rows={3} /></div>

        <button className="primary" type="submit">Save</button>
      </form>
    </div>
  );
}
