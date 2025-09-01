// app/education/booked/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtDate(d?: Date | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
}
function fmtTime(s?: string | null) {
  return s && s.trim() ? s : "—";
}

export default async function EducationBookedPage() {
  const items = await prisma.educationBooking.findMany({
    orderBy: [
      // Use the fields that exist on your model
      { scheduledDate: "asc" },
      { createdAt: "desc" },
    ],
    include: {
      customer: { select: { id: true, salonName: true, customerName: true, salesRep: true } },
      request:  { select: { id: true } },
    },
    take: 200,
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Education Booked</h1>
        <p className="small">Confirmed education sessions (upcoming first).</p>
      </section>

      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 140 }}>Date</th>
              <th style={{ width: 120 }}>Time</th>
              <th>Customer</th>
              <th style={{ width: 160 }}>Sales Rep</th>
              <th style={{ width: 140 }}>Created</th>
              <th style={{ width: 120 }}>Request</th>
              <th style={{ width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map(bk => (
              <tr key={bk.id}>
                <td className="small">{fmtDate(bk.scheduledDate)}</td>
                <td className="small">{fmtTime((bk as any).scheduledTime)}</td>
                <td className="small">
                  {bk.customer ? (
                    <Link href={`/customers/${bk.customer.id}`}>
                      {bk.customer.salonName} — {bk.customer.customerName}
                    </Link>
                  ) : "—"}
                </td>
                <td className="small">{bk.customer?.salesRep || "—"}</td>
                <td className="small">{fmtDate(bk.createdAt)}</td>
                <td className="small">
                  {bk.request ? <Link href={`/education/requests/${bk.request.id}`}>View</Link> : "—"}
                </td>
                <td className="small">
                  {bk.customer && (
                    <Link className="btn" href={`/customers/${bk.customer.id}`}>Profile</Link>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="small muted">No bookings yet.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
