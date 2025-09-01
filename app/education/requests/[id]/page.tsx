// app/education/requests/[id]/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* --- helpers --- */
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

const EDU_LABELS: Record<string, string> = {
  PERMANENT_COLOR: "Permanent colour",
  SEMI_PERMANENT_COLOR: "Semi permanent hair colour",
  CARE_RANGE: "Care Range",
  STYLING_RANGE: "Styling Range",
};

function mapEduTypes(types?: string[] | null): string[] {
  if (!types?.length) return [];
  return types.map((t) => EDU_LABELS[t] ?? t);
}

const isCuid = (s: string) => /^c[a-z0-9]{24,}$/i.test(s);
const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

async function resolveBrandNames(identifiers: string[] | null | undefined) {
  const ids = (identifiers ?? []).map((x) => String(x).trim()).filter(Boolean);
  if (!ids.length) return [] as string[];

  const idList = ids.filter((x) => isCuid(x) || isUuid(x));
  const nameList = ids.filter((x) => !idList.includes(x));

  const rows = await prisma.brand.findMany({
    where: {
      OR: [
        idList.length ? { id: { in: idList } } : undefined,
        nameList.length ? { name: { in: nameList } } : undefined,
      ].filter(Boolean) as any,
    },
    select: { id: true, name: true },
  });

  // Prefer DB names where we matched; include any raw names that didn’t match a DB row
  const foundNames = new Set(rows.map((r) => r.name));
  const names: string[] = [...rows.map((r) => r.name)];
  for (const raw of nameList) {
    if (!foundNames.has(raw)) names.push(raw);
  }
  return names;
}

export default async function EducationRequestDetail({
  params,
}: {
  params: { id: string };
}) {
  // Pull only fields that exist on your model
  const req = await prisma.educationRequest.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      customerId: true,
      notes: true,
      status: true,
      // IMPORTANT: your model uses `brands` (string[]), not `brandIds`
      brands: true,
      educationTypes: true, // enum[]
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
        <Link className="btn" href="/education/requests">
          Back to requests
        </Link>
      </div>
    );
  }

  // Resolve brand names
  const brandNames = await resolveBrandNames(req.brands);

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
    if (brandNames.length) lines.push(`Brands: ${brandNames.join(", ")}`);
    const eduNice = mapEduTypes(req.educationTypes as any);
    if (eduNice.length) lines.push(`Education Types: ${eduNice.join(", ")}`);
    if (req.notes) lines.push(`Request Notes: ${req.notes}`);

    // From booking form
    if (date || time) lines.push(`Scheduled (requested): ${[date, time].filter(Boolean).join(" ")}`);
    if (educatorInput) lines.push(`Educator (requested): ${educatorInput}`);
    if (locationInput) lines.push(`Location (requested): ${locationInput}`);
    if (extraNotes) lines.push(extraNotes);

    const combinedNotes = lines.length ? lines.join("\n\n") : null;

    // Only pass columns that exist on EducationBooking
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
          <Link className="btn" href="/education/requests">
            Back
          </Link>
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
              {brandNames.length ? brandNames.join(", ") : "—"}
            </p>
          </div>

          <div>
            <b>Education Types</b>
            <p className="small" style={{ marginTop: 6 }}>
              {mapEduTypes(req.educationTypes as any).join(", ") || "—"}
            </p>
          </div>
        </div>

        {req.notes && (
          <div>
            <b>Request Notes</b>
            <p className="small" style={{ marginTop: 6, whiteSpace: "pre-line" }}>
              {req.notes}
            </p>
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
            <button className="primary" type="submit">
              Create Booking
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
