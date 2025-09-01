// app/customers/[id]/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import DeleteCustomerButton from "@/components/DeleteCustomerButton";
import RecentOrders from "./RecentOrders";
import { formatDateTimeUK } from "@/lib/dates";

const DOW: Array<"Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"> = [
  "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
];

type OpeningForDay = { open?: boolean; from?: string | null; to?: string | null };
type OpeningHoursObj = Record<string, OpeningForDay>;

/* ---------------- helpers ---------------- */
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

/* ---------- stage helpers (label + color + normalization) ---------- */
type Stage = "LEAD" | "APPOINTMENT_BOOKED" | "SAMPLING" | "CUSTOMER";

function stageLabel(s?: string | null) {
  switch ((s || "").toUpperCase()) {
    case "APPOINTMENT_BOOKED": return "Appointment booked";
    case "SAMPLING":           return "Sampling";
    case "CUSTOMER":           return "Customer";
    case "LEAD":
    default:                   return "Lead";
  }
}
function stageColor(s?: string | null) {
  switch ((s || "").toUpperCase()) {
    case "APPOINTMENT_BOOKED": return { bg: "#e0f2fe", fg: "#075985" }; // sky
    case "SAMPLING":           return { bg: "#fef9c3", fg: "#854d0e" }; // amber
    case "CUSTOMER":           return { bg: "#dcfce7", fg: "#065f46" }; // green
    case "LEAD":
    default:                   return { bg: "#f1f5f9", fg: "#334155" }; // slate
  }
}
function normalizeStage(input: FormDataEntryValue | null): Stage {
  const s = String(input ?? "").trim().toUpperCase();
  if (!s) return "LEAD";
  if (s === "LEAD") return "LEAD";
  if (s === "CUSTOMER" || s === "CLIENT") return "CUSTOMER";
  if (s === "SAMPLING" || s === "SAMPLE") return "SAMPLING";
  if (s === "APPOINTMENT_BOOKED" || s === "APPOINTMENT BOOKED" || s === "APPT" || s === "APPT_BOOKED")
    return "APPOINTMENT_BOOKED";
  return "LEAD";
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

  /* -------- server action: Add Note -------- */
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

  /* -------- server action: Update Stage -------- */
  async function updateStage(formData: FormData) {
    "use server";
    const stage = normalizeStage(formData.get("stage"));
    await prisma.customer.update({
      where: { id: customer.id },
      data: { stage },
    });
    revalidatePath(`/customers/${customer.id}`);
  }

  // Contact number: prefer telephone, fallback to "customerNumber"
  const contactNumber = customer.customerTelephone || customer.customerNumber || "-";
  const stageStyle = stageColor(customer.stage);

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Header card */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>{customer.salonName}</h2>

            {/* Stage pill + quick updater */}
            <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span
                className="small"
                style={{
                  background: stageStyle.bg,
                  color: stageStyle.fg,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontWeight: 600,
                }}
              >
                {stageLabel(customer.stage)}
              </span>

              <form action={updateStage} className="row" style={{ gap: 6, alignItems: "center" }}>
                <select
                  name="stage"
                  defaultValue={(customer.stage as Stage) || "LEAD"}
                  className="input"
                  style={{ height: 30, padding: "2px 8px" }}
                >
                  <option value="LEAD">Lead</option>
                  <option value="APPOINTMENT_BOOKED">Appointment booked</option>
                  <option value="SAMPLING">Sampling</option>
                  <option value="CUSTOMER">Customer</option>
                </select>
                <button className="btn" type="submit" style={{ height: 30 }}>
                  Update
                </button>
              </form>
            </div>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <Link
              href={`/customers/${customer.id}/edit`}
              className="primary"
              style={{ padding: "6px 10px", borderRadius: 10 }}
            >
              Edit
            </Link>

            {/* NEW: Request Education button */}
            <Link
              href={`/education/requests/new?customerId=${customer.id}`}
              className="btn"
              style={{ padding: "6px 10px", borderRadius: 10, background: "#f3f4f6" }}
            >
              Request Education
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

          {/* Salon meta + stage */}
          <div>
            <b>Salon Information</b>
            <p className="small" style={{ marginTop: 6 }}>
              Stage: {stageLabel(customer.stage)}
              <br />
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

      {/* Recent Orders */}
      <RecentOrders customerId={params.id} />

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
                  {formatDateTimeUK(n.createdAt)} {n.staff ? `• ${n.staff}` : ""}
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
                  {formatDateTimeUK(c.createdAt)}
                  {c.staff ? ` • ${c.staff}` : ""}
                  {c.callType ? ` • ${c.callType}` : ""}
                  {c.outcome ? ` • ${c.outcome}` : ""}
                  {c.followUpAt ? ` • follow-up ${formatDateTimeUK(c.followUpAt)}` : ""}
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
