// app/customers/new/page.tsx
import { prisma } from "@/lib/prisma";
import OpeningHours from "@/components/OpeningHours";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  const [reps, brands] = await Promise.all([
    prisma.salesRep.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Create Customer</h1>
      </section>

      <section className="card">
        <form method="POST" action="/api/customers" className="grid" style={{ gap: 14 }}>
          {/* Two-column forms */}
          <div className="grid grid-2">
            {/* LEFT */}
            <div className="grid" style={{ gap: 10 }}>
              <div>
                <label>Salon Name*</label>
                <input name="salonName" required placeholder="" />
              </div>
              <div>
                <label>Address Line 1*</label>
                <input name="addressLine1" required />
              </div>
              <div>
                <label>Address Line 2</label>
                <input name="addressLine2" />
              </div>
              <div>
                <label>Town</label>
                <input name="town" />
              </div>
              <div>
                <label>County</label>
                <input name="county" />
              </div>
              <div>
                <label>Postcode</label>
                <input name="postCode" />
              </div>
              <div>
                <label>Contact Number</label>
                <input name="customerNumber" />
              </div>
              <div>
                <label>Number of Chairs</label>
                <input name="numberOfChairs" type="number" min={0} />
              </div>
            </div>

            {/* RIGHT */}
            <div className="grid" style={{ gap: 10 }}>
              <div>
                <label>Customer Name*</label>
                <input name="customerName" required />
              </div>
              <div>
                <label>Customer Telephone Number</label>
                <input name="customerTelephone" />
              </div>
              <div>
                <label>Customer Email Address</label>
                <input name="customerEmailAddress" type="email" />
              </div>

              <div>
                <label>Brands Used</label>
                <select name="brandsInterestedIn" defaultValue="">
                  <option value="">— Select a brand —</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Sales Rep</label>
                <select name="salesRep" defaultValue="">
                  <option value="">— Select a rep —</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Opening hours */}
          <OpeningHours />

          {/* Notes */}
          <div>
            <label>Notes</label>
            <textarea name="notes" rows={4} placeholder="Anything useful..." />
          </div>

          <div className="right" style={{ gap: 8 }}>
            <button className="btn" type="reset">Reset</button>
            <button className="primary" type="submit">Create</button>
          </div>
        </form>
      </section>
    </div>
  );
}
