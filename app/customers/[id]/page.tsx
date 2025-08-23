// app/customers/[id]/page.tsx
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import VisitForm from "@/components/VisitForm";

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  const [customer, salesReps] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: params.id },
      include: {
        visits: { orderBy: { date: "desc" } },
        notesLog: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.salesRep.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!customer) return <div className="card">Not found.</div>;

  // -------- Server Actions --------
  async function addNote(formData: FormData) {
    "use server";
    const text = String(formData.get("text") || "");
    const staff = String(formData.get("staff") || "");
    if (!text.trim()) return;
    await prisma.note.create({
      data: { text, staff: staff || null, customerId: customer.id },
    });
    revalidatePath(`/customers/${customer.id}`);
  }

  async function addVisit(formData: FormData) {
    "use server";
    const dateStr = String(formData.get("date") || "");
    const summary = String(formData.get("summary") || "");
    const staff = String(formData.get("staff") || "");
    const startStr = String(formData.get("startTime") || "");
    const endStr = String(formData.get("endTime") || "");

    const toDateOnly = (ds: string) => (ds ? new Date(`${ds}T00:00:00`) : new Date());
    const combineDateTime = (dateOnlyStr: string, timeStr: string | null) => {
      if (!timeStr) return null;
      const base = toDateOnly(dateOnlyStr);
      const [h, m] = timeStr.split(":").map(Number);
      const d = new Date(base);
      d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
      return d;
    };

    const startTime = startStr ? combineDateTime(dateStr, startStr) : null;
    const endTime = endStr ? combineDateTime(dateStr, endStr) : null;

    let durationMinutes: number | null = null;
    if (startTime && endTime) {
      const diffMs = endTime.getTime() - startTime.getTime();
      durationMinutes = diffMs >= 0 ? Math.round(diffMs / 60000) : null;
    }

    await prisma.visit.create({
      data: {
        customerId: customer.id,
        date: dateStr ? new Date(dateStr) : new Date(),
        startTime,
        endTime,
        durationMinutes,
        summary: summary || null,
        staff: staff || null, // stores the selected Sales Rep name
      },
    });

    revalidatePath(`/customers/${customer.id}`);
  }
  // -------- /Server Actions --------

  const address = [
    customer.addressLine1,
    customer.addressLine2,
    customer.town,
    customer.county,
    customer.postCode,
  ]
    .filter(Boolean)
    .join(", ");

  const fmtTime = (val?: Date | null) =>
    val ? new Date(val).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-";

  const repNames = salesReps.map((r) => r.name);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <h2>{customer.salonName}</h2>
        <p className="small">{customer.customerName}</p>

        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div>
            <b>Contact</b>
            <p className="small">
              {customer.customerEmailAddress || "-"}
              <br />
              {customer.customerNumber || "-"}
            </p>
          </div>
          <div>
            <b>Location</b>
            <p className="small">{address || "-"}</p>
          </div>
          <div>
            <b>Salon</b>
            <p className="small">
              Days Open: {customer.daysOpen ?? "-"} | Chairs: {customer.numberOfChairs ?? "-"}
            </p>
            <p className="small">Brands Used: {customer.brandsInterestedIn || "-"}</p>
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
        {/* Notes */}
        <div className="card">
          <h3>Add Note</h3>
          <form action={addNote} className="grid" style={{ gap: 8 }}>
            <div>
              <label>Sales Rep (optional)</label>
              <select name="staff" defaultValue="">
                <option value="">— Select Sales Rep —</option>
                {repNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Note</label>
              <textarea name="text" rows={3} required />
            </div>
            <button className="primary" type="submit">
              Save Note
            </button>
          </form>

          <h3 style={{ marginTop: 16 }}>Notes</h3>
          {customer.notesLog.length === 0 ? (
            <p className="small">No notes yet.</p>
          ) : (
            customer.notesLog.map((n) => (
              <div
                key={n.id}
                className="row"
                style={{
                  justifyContent: "space-between",
                  borderBottom: "1px solid var(--border)",
                  padding: "8px 0",
                }}
              >
                <div>
                  <div className="small">
                    {new Date(n.createdAt).toLocaleString()} {n.staff ? `• ${n.staff}` : ""}
                  </div>
                  <div>{n.text}</div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Visits */}
        <div className="card">
          <h3>Log Visit</h3>
          {/* Pass Sales Rep names to the client form for the dropdown */}
          <VisitForm reps={repNames} onSubmit={addVisit as any} />

          <h3 style={{ marginTop: 16 }}>Visits</h3>
          {customer.visits.length === 0 ? (
            <p className="small">No visits yet.</p>
          ) : (
            customer.visits.map((v) => (
              <div
                key={v.id}
                className="row"
                style={{
                  justifyContent: "space-between",
                  borderBottom: "1px solid var(--border)",
                  padding: "8px 0",
                }}
              >
                <div>
                  <div className="small">
                    {new Date(v.date).toLocaleDateString()} {v.staff ? `• ${v.staff}` : ""}
                  </div>
                  <div className="small">
                    {v.startTime || v.endTime ? (
                      <>
                        {fmtTime(v.startTime)} – {fmtTime(v.endTime)}
                        {typeof v.durationMinutes === "number" ? ` • ${v.durationMinutes} min` : ""}
                      </>
                    ) : (
                      "-"
                    )}
                  </div>
                  <div>{v.summary || "-"}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
