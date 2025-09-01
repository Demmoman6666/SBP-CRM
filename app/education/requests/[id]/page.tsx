// app/education/requests/[id]/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateTimeUK } from "@/lib/dates";
import { getCurrentUser } from "@/lib/auth";
import { createCalendarEvent } from "@/lib/google";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- helpers ---------------- */
function fmtDate(d?: Date | null) {
  if (!d) return "—";
  try {
    return formatDateTimeUK(d);
  } catch {
    return new Date(d).toLocaleString("en-GB");
  }
}

function toDateAtLocal(dateStr?: string | null, timeStr?: string | null): Date | null {
  if (!dateStr) return null;
  // Accept yyyy-mm-dd or dd/mm/yyyy
  let isoDate = dateStr;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [dd, mm, yyyy] = dateStr.split("/");
    isoDate = `${yyyy}-${mm}-${dd}`;
  }
  const t = timeStr && /^\d{2}:\d{2}$/.test(timeStr) ? `${timeStr}:00` : "00:00:00";
  const d = new Date(`${isoDate}T${t}`);
  return isNaN(d.getTime()) ? null : d;
}

const EDU_LABELS: Record<string, string> = {
  PERMANENT_COLOR: "Permanent colour",
  SEMI_PERMANENT_COLOR: "Semi permanent hair colour",
  CARE_RANGE: "Care Range",
  STYLING_RANGE: "Styling Range",
};

function prettyEdu(types?: string[] | null) {
  if (!types?.length) return "—";
  return types.map((t) => EDU_LABELS[t] ?? t).join(", ");
}

/* ------------- Calendar helper (optional) ------------- */
async function maybeCreateCalendarBooking(args: {
  start: Date | null;
  customerName: string | null;
  salonName: string | null;
  location?: string | null;
  brands?: string[] | null;
  educationTypes?: string[] | null;
  notes?: string | null;
}) {
  try {
    if (!args.start) return;

    const me = await getCurrentUser();
    if (!me) return;

    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiresAt: true,
        googleCalendarId: true,
      },
    });
    if (!user?.googleAccessToken) return;

    const startIso = args.start.toISOString();
    // Default to 90 minutes for an education session
    const endIso = new Date(args.start.getTime() + 90 * 60 * 1000).toISOString();

    const title = `Education: ${args.salonName || args.customerName || "Customer"}`;
    const descriptionLines = [
      args.salonName ? `Salon: ${args.salonName}` : null,
      args.customerName ? `Contact: ${args.customerName}` : null,
      args.location ? `Location: ${args.location}` : null,
      args.brands?.length ? `Brands: ${args.brands.join(", ")}` : null,
      args.educationTypes?.length ? `Education Types: ${prettyEdu(args.educationTypes)}` : null,
      args.notes ? `\nNotes:\n${args.notes}` : null,
    ].filter(Boolean) as string[];

    await createCalendarEvent(me.id, {
      summary: title,
      description: descriptionLines.join("\n"),
      startIso,
      endIso,
      attendees: user.email ? [{ email: user.email, displayName: user.fullName || undefined }] : [],
    });
  } catch (err) {
    console.error("[education] calendar create failed (non-fatal):", err);
  }
}

export default async function EducationRequestReviewPage({
  params,
}: {
  params: { id: string };
}) {
  const req = await prisma.educationRequest.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      status: true,
      notes: true,
      brands: true,            // string[]
      educationTypes: true,    // enum[]
      customerId: true,
      contactName: true,       // snapshot if present

      customer: {
        select: {
          id: true,
          salonName: true,
          customerName: true,
          salesRep: true,
          addressLine1: true,
          addressLine2: true,
          town: true,
          county: true,
          postCode: true,
          country: true,
          customerTelephone: true,
          customerEmailAddress: true,
        },
      },
    },
  });

  if (!req) {
    return (
      <div className="card">
        <p>Request not found.</p>
        <Link className="btn" href="/education/requests">Back</Link>
      </div>
    );
  }

  /* -------- Server action: create booking + move to BOOKED -------- */
  async function createBooking(formData: FormData) {
    "use server";

    const dateStr = String(formData.get("date") || "");
    const timeStr = String(formData.get("time") || "");
    const educator = String(formData.get("educator") || "");
    const location = String(formData.get("location") || "");
    const internalNotes = String(formData.get("internalNotes") || "");

    const scheduledStart = toDateAtLocal(dateStr || undefined, timeStr || undefined);

    // Create booking using ONLY fields that exist on your model
    await prisma.educationBooking.create({
      data: {
        requestId: req.id,
        customerId: req.customerId,
        // If your model includes educator/location, you can keep these lines.
        // If not, comment them out to match your schema.
        // educator: educator || null,
        // location: location || null,
        notes: internalNotes || null,
        brands: req.brands,
        educationTypes: req.educationTypes,
      },
      select: { id: true },
    });

    // Move request to BOOKED so it drops out of the Requests list
    await prisma.educationRequest.update({
      where: { id: req.id },
      data: { status: "BOOKED" },
    });

    // Optional: create a calendar event if date/time provided
    await maybeCreateCalendarBooking({
      start: scheduledStart,
      customerName: req.customer?.customerName || req.contactName || null,
      salonName: req.customer?.salonName || null,
      location,
      brands: req.brands,
      educationTypes: req.educationTypes as unknown as string[],
      notes: [req.notes, internalNotes].filter(Boolean).join("\n\n").trim() || null,
    });

    redirect("/education/booked");
  }

  const salon = req.customer?.salonName || "—";
  const contact = req.customer?.customerName || req.contactName || "—";
  const phone = req.customer?.customerTelephone || "—";
  const email = req.customer?.customerEmailAddress || "—";

  const locationLine = [req.customer?.town, req.customer?.county, req.customer?.postCode]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Education Request</h1>
            <div className="small muted">Received: {fmtDate(req.createdAt)}</div>
          </div>
          <Link className="btn" href="/education/requests">Back</Link>
        </div>
      </section>

      <section className="card">
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div>
            <b>Customer</b>
            <p className="small" style={{ whiteSpace: "pre-line", marginTop: 6 }}>
              {salon} — {contact}
              {"\n"}
              Rep: {req.customer?.salesRep || "—"}
              {"\n"}
              {phone}
              {"\n"}
              {email}
            </p>
          </div>

          <div>
            <b>Location</b>
            <p className="small" style={{ whiteSpace: "pre-line", marginTop: 6 }}>
              {locationLine || "—"}
            </p>
          </div>

          <div>
            <b>Brands Requested</b>
            <p className="small" style={{ marginTop: 6 }}>
              {req.brands?.length ? req.brands.join(", ") : "—"}
            </p>
          </div>

          <div>
            <b>Education Types</b>
            <p className="small" style={{ marginTop: 6 }}>
              {prettyEdu(req.educationTypes as unknown as string[])}
            </p>
          </div>

          {req.notes && (
            <div style={{ gridColumn: "1 / -1" }}>
              <b>Request Notes</b>
              <p className="small" style={{ marginTop: 6 }}>{req.notes}</p>
            </div>
          )}
        </div>
      </section>

      {/* ---- Create Booking ---- */}
      <section className="card">
        <h3>Create Booking</h3>
        <form action={createBooking} className="grid" style={{ gap: 10 }}>
          <div className="grid grid-2">
            <div className="field">
              <label>Date (optional)</label>
              <input type="date" name="date" />
            </div>
            <div className="field">
              <label>Time (optional)</label>
              <input type="time" name="time" />
            </div>
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label>Educator (optional)</label>
              <input name="educator" placeholder="Trainer name" />
            </div>
            <div className="field">
              <label>Location (optional)</label>
              <input name="location" placeholder="Salon / Venue" />
            </div>
          </div>

          <div className="field">
            <label>Internal Notes (optional)</label>
            <input name="internalNotes" placeholder="Anything else to record…" />
          </div>

          <div className="right">
            <button className="primary" type="submit">Create Booking</button>
          </div>
        </form>
      </section>
    </div>
  );
}
