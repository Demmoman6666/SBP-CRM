// app/education/requests/[id]/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtDateTime(d?: Date | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default async function EducationRequestDetail({
  params,
}: { params: { id: string } }) {
  const req = await prisma.educationRequest.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      customerId: true,
      notes: true,
      status: true,
      // ⬇️ Ensure these are present for TS
      brandNames: true,
      educationTypes: true,
      // relation
      customer: {
        select: {
          id: true,
          salonName: true,
          customerName: true,
          salesRep: true,
          customerTelephone: true,
          customerEmailAddress: true,
          town: true,
          county: true,
          postCode: true,
        },
      },
    },
  });

  if (!req) {
    return (
      <div className="card">
        <h1>Education Request</h1>
        <p className="small">Not found.</p>
        <Link className="btn" href="/education/requests">Back to requests</Link>
      </div>
    );
  }

  /** Create a booking using only fields that exist on EducationBooking.
   *  Extra fields are folded into the booking `notes`.
   */
  async function createBooking(formData: FormData) {
    "use server";
    const date = String(formData.get("date") || "").trim();
    const time = String(formData.get("time") || "").trim();
    const educatorInput = String(formData.get("educator") || "").trim();
    const locationInput = String(formData.get("location") || "").trim();
    const extraNotes = String(formData.get("notes") || "").trim();

    const lines: string[] = [];

    // From request itself
    if (req.brandNames?.length) lines.push(`Brands: ${req.brandNames.join(", ")}`);
    if (req.educationTypes?.length) lines.push(`Education Types: ${req.educationTypes.join(", ")}`);
    if (req.notes) lines.push(`Request Notes: ${req.notes}`);

    // From booking form
    if (date || time) lines.push(`Scheduled (requested): ${[date, time].filter(Boolean).join(" ")}`);
    if (educatorInput) lines.push(`Educator (requested): ${educatorInput}`);
    if (locationInput) lines.push(`Location (requested): ${locationInput}`);
    if (extraNotes) lines.push(extraNotes);

    const combinedNotes = lines.length ? lines.join("\n\n") : null;

    // ✅ Only pass columns that exist on EducationBooking
    await prisma.educationBooking.create({
      data: {
        requestId: req.id,
        customerId: req.customerId,
        notes: combinedNotes,
      },
    });

    // Mark request as BOOKED
    await prisma.educationRequest.update({
      where: { id: req.id },
      data: { status: "BOOKED" },
    });

    revalidatePath("/education/requests");
    revalidatePath("/education/booked");
    redirect("/education/booked");
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Education Request</h1>
            <div className="small muted">Received: {fmtDateTime(req.createdAt)}</div>
          </div>
          <Link className="btn" href="/education/requests">Back</Link>
        </div>
      </section>

      {/* Request details */}
      <section className="card grid" style={{ gap: 10 }}>
        <div className="grid grid-2">
          <div>
            <b>Customer</b>
            <p className="small" style={{ marginTop: 6 }}>
              {req.customer ? (
                <>
                  <Link href={`/customers/${req.customer.id}`}>
                    {req.customer.salonName} — {req.customer.customerName}
                  </Link>
                  <br />
                  Rep: {req.customer.salesRep || "—"}
                  <br />
                  {req.customer.customerTelephone || "—"}
                  <br />
                  {req.customer.customerEmailAddress || "—"}
                </>
              ) : (
                "—"
              )}
            </p>
          </div>

          <div>
            <b>Location</b>
            <p className="small" style={{ marginTop: 6, whiteSpace: "pre-line" }}>
              {[req.customer?.town, req.customer?.county, req.customer?.postCode]
                .filter(Boolean)
                .join(", ") || "—"}
            </p>
          </div>

          <div>
            <b>Brands Requested</b>
            <p className="small" style={{ marginTop: 6 }}>
              {req.brandNames?.length ? req.brandNames.join(", ") : "—"}
            </p>
          </div>

          <div>
            <b>Education Types</b>
            <p className="small" style={{ marginTop: 6 }}>
              {req.educationTypes?.length ? req.educationTypes.join(", ") : "—"}
            </p>
          </div>
        </div>

        {req.notes && (
          <div>
            <b>Request Notes</b>
            <p className="small" style={{ marginTop: 6, whiteSpace: "pre-line" }}>{req.notes}</p>
          </div>
        )}
      </section>

      {/* Booking form — stores date/time/educator/location in notes */}
      <section className="card">
        <h3>Create Booking</h3>
        <form action={createBooking} className="grid" style={{ gap: 10 }}>
          <div className="grid grid-3" style={{ gap: 10 }}>
            <div>
              <label>Date (optional)</label>
              <input type="date" name="date" />
            </div>
            <div>
              <label>Time (optional)</label>
              <input type="time" name="time" />
            </div>
            <div>
              <label>Educator (optional)</label>
              <input name="educator" placeholder="Trainer name" />
            </div>
          </div>

          <div className="grid grid-2" style={{ gap: 10 }}>
            <div>
              <label>Location (optional)</label>
              <input name="location" placeholder="Salon / Venue" />
            </div>
            <div>
              <label>Internal Notes (optional)</label>
              <input name="notes" placeholder="Anything else to record…" />
            </div>
          </div>

          <div className="right">
            <button className="primary" type="submit">Create Booking</button>
          </div>
        </form>
      </section>
    </div>
  );
}
