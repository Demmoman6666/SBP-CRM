// app/customers/new/page.tsx
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export default function NewCustomerPage() {
  async function createCustomer(formData: FormData) {
    "use server";

    const toStr = (k: string) => String(formData.get(k) ?? "").trim() || null;
    const toInt = (k: string) => {
      const v = String(formData.get(k) ?? "").trim();
      return v ? parseInt(v, 10) : null;
    };

    const data = {
      salonName: toStr("salonName")!,
      customerName: toStr("customerName")!,
      addressLine1: toStr("addressLine1")!,
      addressLine2: toStr("addressLine2"),
      town: toStr("town"),
      county: toStr("county"),
      postCode: toStr("postCode"),
      daysOpen: toStr("daysOpen"),
      brandsInterestedIn: toStr("brandsInterestedIn"),
      notes: toStr("notes"),
      salesRep: toStr("salesRep"),
      customerNumber: toStr("customerNumber"),
      customerEmailAddress: toStr("customerEmailAddress"),
      openingHours: toStr("openingHours"),
      numberOfChairs: toInt("numberOfChairs"),
    };

    await prisma.customer.create({ data: data as any });
    redirect("/customers");
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <h2>New Customer</h2>
        <form action={createCustomer} className="grid grid-2" style={{ gap: 12 }}>
          <div><label>Salon Name *</label><input name="salonName" required /></div>
          <div><label>Customer Name *</label><input name="customerName" required /></div>

          <div><label>Address Line 1 *</label><input name="addressLine1" required /></div>
          <div><label>Address Line 2</label><input name="addressLine2" /></div>

          <div><label>Town</label><input name="town" /></div>
          <div><label>County</label><input name="county" /></div>

          <div><label>Post Code</label><input name="postCode" /></div>
          <div><label>Days Open</label><input name="daysOpen" placeholder="e.g. Mon–Sat" /></div>

          <div><label>Brands Interested in</label><input name="brandsInterestedIn" /></div>
          <div><label>Sales Rep</label><input name="salesRep" /></div>

          <div><label>Customer Number</label><input name="customerNumber" /></div>
          <div><label>Customer Email Address</label><input name="customerEmailAddress" type="email" /></div>

          <div><label>Opening Hours</label><input name="openingHours" placeholder="e.g. 9–5" /></div>
          <div><label>Number of Chairs</label><input name="numberOfChairs" type="number" min="0" /></div>

          <div className="grid" style={{ gridColumn: "1 / -1" }}>
            <label>Notes</label>
            <textarea name="notes" rows={4} />
          </div>

          <div className="row" style={{ gap: 8, gridColumn: "1 / -1" }}>
            <button type="submit" className="primary">Save</button>
            <a href="/customers" className="link">Cancel</a>
          </div>
        </form>
      </div>
    </div>
  );
}
