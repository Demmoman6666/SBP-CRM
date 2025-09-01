// app/education/requests/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmt(d?: Date | null) {
  if (!d) return "-";
  const x = new Date(d);
  return x.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export default async function EducationRequestedPage({
  searchParams,
}: {
  searchParams?: { rep?: string };
}) {
  const rep = (searchParams?.rep || "").trim();

  const requests = await prisma.educationRequest.findMany({
    where: {
      status: "REQUESTED",
      ...(rep ? { customer: { salesRep: rep } } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { salonName: true, customerName: true, salesRep: true } },
    },
  });

  // fetch reps for filter
  const reps = await prisma.salesRep.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Education Requested</h1>
            <p className="small">Review incoming education requests and convert to bookings.</p>
          </div>
          <Link href="/education" className="btn">Back</Link>
        </div>
      </section>

      {/* Filter by Sales Rep */}
      <section className="card">
        <form className="row" style={{ gap: 10, alignItems: "end" }}>
          <div>
            <label className="small">Sales Rep</label>
            <select
              name="rep"
              defaultValue={rep}
              onChange={(e) => {
                const v = e.currentTarget.value;
                const qs = new URLSearchParams(v ? { rep: v } : {});
                window.location.search = qs.toString();
              }}
            >
              <option value="">— Any —</option>
              {reps.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          </div>
        </form>
      </section>

      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Requested</th>
              <th>Salon</th>
              <th>Contact</th>
              <th>Sales Rep</th>
              <th>Brands</th>
              <th>Types</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="small">{fmt(r.createdAt)}</td>
                <td className="small">{r.customer?.salonName || r.salonName || "-"}</td>
                <td className="small">{r.customer?.customerName || r.contactName || "-"}</td>
                <td className="small">{r.customer?.salesRep || "-"}</td>
                <td className="small">{(r.brandNames?.length ? r.brandNames : r.brandIds)?.join(", ") || "—"}</td>
                <td className="small">{r.educationTypes?.join(", ") || "—"}</td>
                <td className="right">
                  <Link className="btn" href={`/education/requests/${r.id}`}>Review</Link>
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr><td colSpan={7}><div className="small muted">No requests found.</div></td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
