// app/customers/new/page.tsx
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export default function NewCustomerPage() {
  async function createCustomer(formData: FormData) {
    "use server";
    const s = (n: string) => {
      const v = String(formData.get(n) ?? "").trim();
      return v ? v : null;
    };
    const toInt = (n: string) => {
      const v = formData.get(n);
      if (v == null || v === "") return null;
      const num = Number(v);
      return Number.isFinite(num) ? num : null;
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
      brandsInterestedIn: s("brandsInterestedIn"),
      notes: s("notes"),
      salesRep: s("salesRep"),
      customerNumber: s("customerNumber"),
      customerEmailAddress: s("customerEmailAddress"),
      openingHours: s("openingHours"),
      numberOfChairs: toInt("numberOfChairs"),
    };

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
          <div><label>Brands Interested in</label><input name="brandsInterestedIn" /></div>
          <div><label>Sales Rep</label><input name="salesRep" /></div>
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

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="reset">Reset</button>
          <button className="primary" type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}
