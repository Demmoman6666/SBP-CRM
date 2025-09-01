// app/education/requests/[id]/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmt(d?: Date | null) {
  if (!d) return "-";
  const x = new Date(d);
  return x.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

async function getData(id: string) {
  return prisma.educationRequest.findUnique({
    where: { id },
    include: {
      customer: {
        select: {
          id: true, salonName: true, customerName: true, salesRep: true,
          addressLine1: true, addressLine2: true, town: true, county: true, postCode: true, country: true,
          customerTelephone: true, customerEmailAddress: true,
        }
      },
      booking: true,
    },
  });
}

export default async function RequestDetailPage({ params }: { params: { id: string } }) {
  const req = await getData(params.id);
  if (!req) return <div className="card">Not found.</div>;

  // Server action: create booking and mark request as BOOKED
  async function createBooking(form: FormData) {
    "use server";
    const date = String(form.get("date") || "");
    const time = String(form.get("time") || "");
    const educator = String(form.get("educator") || "");
    const location = String(form.get("location") || "");
    const notes = String(form.get("notes") || "");

    // merge date & time -> Date
    let scheduledAt: Date | null = null;
    if (date) {
      const t = time || "09:00";
      scheduledAt = new Date(`${date}T${t}:00`);
    }

    // Create booking
    const booking = await prisma.educationBooking.create({
      data: {
        requestId: req.id,
        customerId: req.customerId,
        scheduledAt,
        educator: educator || null,
        location: location || null,
        brandIds: req.brandIds,
        educationTypes: req.educationTypes,
        notes: notes || req.notes || null,
        status: "BOOKED",
      },
      select: { id: true },
    });

    // Update request -> BOOKED and link the booking
    await prisma.educationRequest.update({
      where: { id: req.id },
      data: { status: "BOOKED", bookingId: booking.id },
    });

    redirect("/education/booked");
  }

  const addressLines = [
    req.addressLine1 ?? req.customer?.addressLine1,
    req.addressLine2 ?? req.customer?.addressLine2,
    req.town ?? req.customer?.town,
    req.county ?? req.customer?.county,
    req.postCode ?? req.customer?.postCode,
    req.country ?? req.customer?.country,
  ].filter(Boolean).join(", ");

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Request from {req.customer?.salonName || req.salonName || "-"}</h1>
            <p className="small muted">
              Requested: {fmt(req.createdAt)} • Status: {req.status}
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Link href="/education/requests" className="btn">Back</Link>
            <Link href={`/customers/${req.customerId}`} className="btn">View Customer</Link>
          </div>
        </div>
      </section>

      {/* Snapshot */}
      <section className="card grid" style={{ gap: 8 }}>
        <div className="grid grid-2">
          <div>
            <b>Salon</b>
            <p className="small" style={{ marginTop: 6 }}>
              {req.customer?.salonName || req.salonName || "-"}
              <br />
              Contact: {req.customer?.customerName || req.contactName || "-"}
              <br />
              Rep: {req.customer?.salesRep || "-"}
            </p>
          </div>
          <div>
            <b>Contact</b>
            <p className="small" style={{ marginTop: 6 }}>
              {req.telephone || req.customer?.customerTelephone || "-"}
              <br />
              {req.email || req.customer?.customerEmailAddress || "-"}
            </p>
          </div>
          <div>
            <b>Address</b>
            <p className="small" style={{ marginTop: 6 }}>{addressLines || "-"}</p>
          </div>
          <div>
            <b>Requested</b>
            <p className="small" style={{ marginTop: 6 }}>
              Brands: {(req.brandNames?.length ? req.brandNames : req.brandIds).join(", ") || "—"}
              <br />
              Types: {req.educationTypes.join(", ") || "—"}
            </p>
          </div>
        </div>

        {req.notes && (
          <div>
            <b>Notes</b>
            <p className="small" style={{ marginTop: 6 }}>{req.notes}</p>
          </div>
        )}
      </section>

      {/* Create Booking */}
      {req.status !== "BOOKED" ? (
        <section className="card">
          <h3>Create Booking</h3>
          <form action={createBooking} className="grid" style={{ gap: 10, maxWidth: 720 }}>
            <div className="grid grid-2">
              <div>
                <label>Date</label>
                <input type="date" name="date" />
              </div>
              <div>
                <label>Time</label>
                <input type="time" name="time" />
              </div>
            </div>
            <div className="grid grid-2">
              <div>
                <label>Educator</label>
                <input name="educator" placeholder="Educator name" />
              </div>
              <div>
                <label>Location</label>
                <input name="location" placeholder="On-site / Academy / Address" />
              </div>
            </div>
            <div>
              <label>Notes (optional)</label>
              <textarea name="notes" rows={3} placeholder="Anything the educator should know…" />
            </div>
            <div className="right">
              <button className="primary" type="submit">Book Education</button>
            </div>
          </form>
        </section>
      ) : (
        <section className="card">
          <p className="small">This request has been booked.</p>
          <Link className="btn" href="/education/booked">Go to Booked list</Link>
        </section>
      )}
    </div>
  );
}
