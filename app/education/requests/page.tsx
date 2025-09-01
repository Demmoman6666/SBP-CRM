// app/education/requests/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

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

// Map your enum values to human labels (adjust if your enum differs)
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

export default async function EducationRequestsPage() {
  const rows = await prisma.educationRequest.findMany({
    where: { status: "REQUESTED" }, // only requests that need review
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      status: true,
      notes: true,
      // IMPORTANT: your model uses `brands` (string[])
      brands: true,
      // enum[] on your model
      educationTypes: true,
      // snapshot contact fields (optional on your model)
      contactName: true,
      // relation
      customer: {
        select: {
          salonName: true,
          customerName: true,
          salesRep: true,
        },
      },
    },
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Education Requested</h1>
            <p className="small">Leads asking for training.</p>
          </div>
          <Link className="btn" href="/education">
            Back
          </Link>
        </div>
      </section>

      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 160 }}>Created</th>
              <th>Salon</th>
              <th style={{ width: 180 }}>Contact</th>
              <th style={{ width: 160 }}>Sales Rep</th>
              <th>Brands</th>
              <th style={{ width: 220 }}>Education Types</th>
              <th style={{ width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="small">{fmtDateTime(r.createdAt)}</td>
                <td className="small">
                  {r.customer ? r.customer.salonName : "—"}
                </td>
                <td className="small">
                  {r.customer?.customerName || r.contactName || "—"}
                </td>
                <td className="small">{r.customer?.salesRep || "—"}</td>
                <td className="small">
                  {r.brands?.length ? r.brands.join(", ") : "—"}
                </td>
                <td className="small">{prettyEdu(r.educationTypes)}</td>
                <td className="right">
                  <Link className="btn" href={`/education/requests/${r.id}`}>
                    Review
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="small muted">No requests right now.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
