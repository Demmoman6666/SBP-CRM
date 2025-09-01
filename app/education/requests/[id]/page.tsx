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
    include: {
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

  /* ---------- server action: create booking (no scheduledAt) ---------- */
  async function createBooking(formData: FormData) {
    "use server";
    const educator = String(formData.get("educator") || "").trim() || null;
    const location = String(formData.get("location") || "").trim() || null;

    // Optional date/time inputs — we’ll stash these inside notes
    const date = String(formData.get("date") || "").trim();
    const time = String(formData.get("time") || "").trim();
    const extraNotes = String(formData.get("notes") || "").trim();

    const scheduledSnippet =
      date || time ? `Scheduled (requested): ${date || "—"} ${time || ""}`.trim() : "";

    const combinedNotes = [req.notes || "", scheduledSnippet, extraNotes]
      .filter(Boolean)
      .join("\n\n");

    // Create a booking WITHOUT scheduledAt (your model doesn’t have it yet)
    await prisma.educationBooking.create({
      data: {
        requestId: req.id,
        customerId: req.customerId,
        educator,
        location,
        // Arrays come across from the request
        brandIds: req.brandIds,
        brandNames: req.brandNames,
        educationTypes: req.educationTypes,
        notes: combinedNotes || null,
      },
    });

    // Mark request as booked
    await prisma.educationRequest.update({
      where: { id: req.id },
      data: { status: "BOOKED" },
    });

    // Refresh lists and go to Booked
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

      {/* Booking form (no scheduledAt; date/time are saved into notes) */}
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
