// app/customers/[id]/page.tsx
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      visits: { orderBy: { date: "desc" } },
      notesLog: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!customer) return <div className="card">Not found.</div>;

  async function addNote(formData: FormData) {
    "use server";
    const text = String(formData.get("text") || "");
    const staff = String(formData.get("staff") || "");
    if (!text.trim()) return;
    await prisma.note.create({ data: { text, staff: staff || null, customerId: customer.id } });
    revalidatePath(`/customers/${customer.id}`);
  }

  async function addVisit(formData: FormData) {
    "use server";
    const dateStr = String(formData.get("date") || "");
    const summary = String(formData.get("summary") || "");
    const staff = String(formData.get("staff") || "");
    await prisma.visit.create({
      data: {
        customerId: customer.id,
        date: dateStr ? new Date(dateStr) : new Date(),
        summary: summary || null,
        staff: staff || null,
      },
    });
    revalidatePath(`/customers/${customer.id}`);
  }

  const address = [
    customer.addressLine1,
    customer.addressLine2,
    customer.town,
    customer.county,
    customer.postCode,
  ].filter(Boolean).join(", ");

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <h2>{customer.salonName}</h2>
        <p className="small">{customer.customerName}</p>

        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div>
            <b>Contact</b>
            <p className="small">
              {customer.customerEmailAddress || "-"}<br />
              {customer.customerNumber || "-"}
            </p>
          </div>
          <div>
            <b>Location</b>
            <p className="small">{address || "-"}</p>
          </div>
          <div>
            <b>Salon</b>
            <p className="small">Days Open: {customer.daysOpen ?? "-"} | Chairs: {customer.numberOfChairs ?? "-"}</p>
            <p className="small">Brands Interested: {customer.brandsInterestedIn || "-"}</p>
            <p className="small">Sales Rep: {customer.salesRep || "-"}</p>
          </div>
          <div>
            <b>Opening Hours</b>
            <p className="small">{customer.openingHours || "-"}</p>
          </div>
        </div>

        {customer.notes && (
          <div style={{ marginTop: 12 }}>
            <b>Profile Notes</b>
            <p className="small">{customer.notes}</p>
          </div>
        )}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>Add Note</h3>
          <form action={addNote} className="grid" style={{ gap: 8 }}>
            <div><label>Staff (optional)</label><input name="staff" placeholder="Your name" /></div>
            <div><label>Note</label><textarea name="text" rows={3} required /></div>
            <button className="primary" type="submit">Save Note</button>
          </form>

          <h3 style={{ marginTop: 16 }}>Notes</h3>
          {customer.notesLog.length === 0 ? <p className="small">No notes yet.</p> :
            customer.notesLog.map(n => (
              <div key={n.id} className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                <div>
                  <div className="small">{new Date(n.createdAt).toLocaleString()} {n.staff ? `• ${n.staff}` : ""}</div>
                  <div>{n.text}</div>
                </div>
              </div>
            ))
          }
        </div>

        <div className="card">
          <h3>Log Visit</h3>
          <form action={addVisit} className="grid" style={{ gap: 8 }}>
            <div className="grid grid-2">
              <div><label>Date</label><input type="date" name="date" /></div>
              <div><label>Staff (optional)</label><input name="staff" placeholder="Your name" /></div>
            </div>
            <div><label>Summary</label><textarea name="summary" rows={3} placeholder="What happened?" /></div>
            <button className="primary" type="submit">Save Visit</button>
          </form>

          <h3 style={{ marginTop: 16 }}>Visits</h3>
          {customer.visits.length === 0 ? <p className="small">No visits yet.</p> :
            customer.visits.map(v => (
              <div key={v.id} className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                <div>
                  <div className="small">{new Date(v.date).toLocaleDateString()} {v.staff ? `• ${v.staff}` : ""}</div>
                  <div>{v.summary || "-"}</div>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}
