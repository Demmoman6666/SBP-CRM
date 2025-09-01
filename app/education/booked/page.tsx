// app/education/booked/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmt(d?: Date | null) {
  if (!d) return "-";
  const x = new Date(d);
  return x.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export default async function EducationBookedPage() {
  const items = await prisma.educationBooking.findMany({
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    include: {
      customer: { select: { salonName: true, customerName: true, salesRep: true } },
      request: { select: { id: true } },
    },
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Education Booked</h1>
            <p className="small">All scheduled/created education bookings.</p>
          </div>
          <Link href="/education" className="btn">Back</Link>
        </div>
      </section>

      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Salon</th>
              <th>Contact</th>
              <th>Rep</th>
              <th>Educator</th>
              <th>Types</th>
              <th>From Request</th>
            </tr>
          </thead>
          <tbody>
            {items.map(b => (
              <tr key={b.id}>
                <td className="small">{fmt(b.scheduledAt)}</td>
                <td className="small">{b.customer?.salonName || "-"}</td>
                <td className="small">{b.customer?.customerName || "-"}</td>
                <td className="small">{b.customer?.salesRep || "-"}</td>
                <td className="small">{b.educator || "—"}</td>
                <td className="small">{b.educationTypes?.join(", ") || "—"}</td>
                <td className="small">
                  {b.request?.id ? <Link className="btn" href={`/education/requests/${b.request.id}`}>View</Link> : "—"}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7}><div className="small muted">No bookings yet.</div></td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
