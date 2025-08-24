// app/customers/[id]/page.tsx
import Link from "next/link";
import DeleteCustomerButton from "@/components/DeleteCustomerButton";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

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

/* Helpers to present address & opening hours nicely */
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
  // accept HH:mm or H:mm
  return /^\d{1,2}:\d{2}$/.test(t) ? t : null;
}

function renderOpeningHours(openingHours?: string | null) {
  const parsed = parseOpeningHours(openingHours);
  if (!parsed) {
    // Fallback: show raw text or dash
    return <p className="small">{openingHours || "-"}</p>;
  }

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

        let text = "Closed";
        if (isOpen) {
          text = from && to ? `${from} – ${to}` : "Open";
        }

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
      visits: { orderBy: { date: "desc" } },
      notesLog: { orderBy: { createdAt: "desc" } },
      callLogs: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!customer) return <div className="card">Not found.</div>;

  /* Server actions */
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
    const staff = String(formData.get("staff") || ""); // ← FIXED
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

  const contactBlock =
    [customer.customerEmailAddress, customer.customerNumber].filter(Boolean).join("\n") || "-";

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Header card */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <h2>{customer.salonName}</h2>
            <p className="small">{customer.customerName}</p>
          </div>

          {/* Actions */}
          <div className="right" style={{ gap: 8 }}>
            <Link href={`/customers/${customer.id}/edit`} className="btn">Edit</Link>
            <DeleteCustomerButton id={customer.id} />
          </div>
        </div>

        <div className="grid grid-2" style={{ marginTop: 10 }}>
          {/* Contact */}
          <div>
            <b>Contact</b>
            <p className="small" style={{ whiteSpace: "pre-line", marginTop: 6 }}>
              {contactBlock}
            </p>
          </div>

          {/* Location (stacked lines) */}
          <div>
            <b>Location</b>
            <p className="small" style={{ whiteSpace: "pre-line", marginTop: 6 }}>
              {addressLines(customer).length ? addressLines(customer).join("\n") : "-"}
            </p>
          </div>

          {/* Salon meta */}
          <div>
            <b>Salon</b>
            <p className="small" style={{ marginTop: 6 }}>
              Chairs: {customer.numberOfChairs ?? "-"}
              <br />
              Brands Used: {customer.brandsInterestedIn || "-"}
              <br />
              Sales Rep: {customer.salesRep || "-"}
            </p>
          </div>

          {/* Opening hours (pretty) */}
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

      {/* Notes / Visits */}
      <div className="grid grid-2">
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

        <div className="card">
          <h3>Log Visit</h3>
          <form action={addVisit} className="grid" style={{ gap: 8 }}>
            <div className="grid grid-2">
              <div>
                <label>Date</label>
                <input type="date" name="date" />
              </div>
              <div>
                <label>Sales Rep (optional)</label>
                <input name="staff" placeholder="Your name" />
              </div>
            </div>
            <div>
              <label>Summary</label>
              <textarea name="summary" rows={3} placeholder="What happened?" />
            </div>
            <button className="primary" type="submit">Save Visit</button>
          </form>

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
                  <div>{v.summary || "-"}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Call logs */}
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
