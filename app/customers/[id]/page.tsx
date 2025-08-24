// app/customers/[id]/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import DeleteCustomerButton from "@/components/DeleteCustomerButton";

const DOW: Array<"Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"> = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];

type OpeningForDay = { open?: boolean; from?: string | null; to?: string | null };
type OpeningHoursObj = Record<string, OpeningForDay>;

/* Helpers */
function addressLines(c: any): string[] {
  return [c.addressLine1, c.addressLine2, c.town, c.county, c.postCode].filter(Boolean);
}

function parseOpeningHours(src?: string | null): OpeningHoursObj | null {
  if (!src) return null;
  try {
    const obj = JSON.parse(src);
    if (obj && typeof obj === "object") return obj as OpeningHoursObj;
  } catch {}
  return null;
}

function prettyTime(s?: string | null): string | null {
  if (!s) return null;
  const t = String(s).trim();
  return /^\d{1,2}:\d{2}$/.test(t) ? t : null; // accept HH:mm or H:mm
}

function renderOpeningHours(openingHours?: string | null) {
  const parsed = parseOpeningHours(openingHours);
  if (!parsed) return <p className="small">{openingHours || "-"}</p>;

  return (
    <div
      className="small"
      style={{
        display: "grid",
        gridTemplateColumns: "56px 1fr",
        rowGap: 4,
        columnGap: 10,
        alignItems: "baseline",
        whiteSpace: "nowrap",
      }}
    >
      {DOW.map((d) => {
        const it: OpeningForDay = (parsed as any)[d] || {};
        const isOpen = !!it.open;
        const from = prettyTime(it.from);
        const to = prettyTime(it.to);
        const text = isOpen ? (from && to ? `${from} – ${to}` : "Open") : "Closed";

        return (
          <div key={d} style={{ display: "contents" }}>
            <div style={{ color: "var(--muted)" }}>{d}</div>
            <div>{text}</div>
          </div>
        );
      })}
    </div>
  );
}

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      visits: { orderBy: { date: "desc" } },                // kept for data consistency
      notesLog: { orderBy: { createdAt: "desc" } },
      callLogs: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!customer) return <div className="card">Not found.</div>;

  /* Server action: Add Note */
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

  // Contact number: prefer telephone, fallback to "customerNumber" if that’s what you used historically
  const contactNumber = customer.customerTelephone || customer.customerNumber || "-";

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Header card */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2>{customer.salonName}</h2>
            {/* Removed contact name from under the title per request */}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Link
              href={`/customers/${customer.id}/edit`}
              className="primary"
              style={{ padding: "6px 10px", borderRadius: 10 }}
            >
              Edit
            </Link>
            <DeleteCustomerButton id={customer.id} />
          </div>
        </div>

        <div className="grid grid-2" style={{ marginTop: 10 }}>
          {/* Contact */}
          <div>
            <b>Contact</b>
            <p className="small" style={{ whiteSpace: "pre-line", marginTop: 6 }}>
              {customer.customerName || "-"}
              {"\n"}
              {contactNumber}
              {"\n"}
              {customer.customerEmailAddress || "-"}
            </p>
          </div>

          {/* Location */}
          <div>
            <b>Location</b>
            <p className="small" style={{ whiteSpace: "pre-line", marginTop: 6 }}>
              {addressLines(customer).length ? addressLines(customer).join("\n") : "-"}
            </p>
          </div>

          {/* Salon meta (renamed) */}
          <div>
            <b>Salon Information</b>
            <p className="small" style={{ marginTop: 6 }}>
              Chairs: {customer.numberOfChairs ?? "-"}
              <br />
              Brands Used: {customer.brandsInterestedIn || "-"}
              <br />
              Sales Rep: {customer.salesRep || "-"}
            </p>
          </div>

          {/* Opening hours */}
          <div>
            <b>Opening Hours</b>
            <div style={{ marginTop: 6 }}>{renderOpeningHours(customer.openingHours)}</div>
          </div>
        </div>

        {customer.notes && (
          <div style={{ marginTop: 12 }}>
            <b>Profile Notes</b>
            <p className="small">{customer.notes}</p>
          </div>
        )}
      </div>

      {/* Add Note */}
      <div className="card">
        <h3>Add Note</h3>
        <form action={addNote} className="grid" style={{ gap: 8 }}>
          <div>
            <label>Sales Rep (optional)</label>
            <input name="staff" placeholder="Your name" />
          </div>
          <div>
            <label>Note</label>
            <textarea name="text" rows={3} required />
          </div>
          <button className="primary" type="submit">Save Note</button>
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

      {/* Call Logs */}
      <div className="card">
        <h3>Call Logs</h3>
        {customer.callLogs.length === 0 ? (
          <p className="small">No calls logged yet.</p>
        ) : (
          customer.callLogs.map((c) => (
            <div
              key={c.id}
              className="row"
              style={{
                justifyContent: "space-between",
                borderBottom: "1px solid var(--border)",
                padding: "8px 0",
              }}
            >
              <div>
                <div className="small">
                  {new Date(c.createdAt).toLocaleString()}
                  {c.staff ? ` • ${c.staff}` : ""}
                  {c.callType ? ` • ${c.callType}` : ""}
                  {c.outcome ? ` • ${c.outcome}` : ""}
                  {c.followUpAt ? ` • follow-up ${new Date(c.followUpAt as any).toLocaleString()}` : ""}
                </div>
                <div>{c.summary || "-"}</div>

                {!c.isExistingCustomer && (
                  <div className="small muted">
                    Lead: {c.customerName || "-"}
                    {c.contactPhone ? ` • ${c.contactPhone}` : ""}
                    {c.contactEmail ? ` • ${c.contactEmail}` : ""}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
