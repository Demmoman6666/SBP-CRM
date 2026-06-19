import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type PageProps = {
  searchParams?: { q?: string };
};

const STAGE_LABEL: Record<string, string> = {
  LEAD: "Lead",
  APPOINTMENT_BOOKED: "Appointment",
  SAMPLING: "Sampling",
  CUSTOMER: "Customer",
};
const STAGE_COLOR: Record<string, string> = {
  LEAD: "#e0e7ff",
  APPOINTMENT_BOOKED: "#fef9c3",
  SAMPLING: "#fce7f3",
  CUSTOMER: "#dcfce7",
};
const STAGE_TEXT: Record<string, string> = {
  LEAD: "#3730a3",
  APPOINTMENT_BOOKED: "#92400e",
  SAMPLING: "#9d174d",
  CUSTOMER: "#166534",
};

export default async function CustomersPage({ searchParams }: PageProps) {
  const q = (searchParams?.q ?? "").trim();

  const ci = (value: string) => ({ contains: value, mode: "insensitive" as const });

  const where: Prisma.CustomerWhereInput = q
    ? {
        OR: [
          { salonName: ci(q) },
          { customerName: ci(q) },
          { customerEmailAddress: ci(q) },
          { town: ci(q) },
          { county: ci(q) },
          { postCode: ci(q) },
          { brandsInterestedIn: ci(q) },
        ],
      }
    : {};

  const customers = await prisma.customer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { rep: { select: { name: true } } },
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1 style={{ marginBottom: 2 }}>Customers</h1>
            <p className="small muted">{customers.length} {q ? "results" : "total"}</p>
          </div>
          <Link className="primary" href="/customers/new">+ New Customer</Link>
        </div>
      </section>

      <section className="card">
        <form action="/customers" method="get" style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            name="q"
            placeholder="Search name, email, town, postcode..."
            defaultValue={q}
            style={{ flex: 1 }}
          />
          <button type="submit" className="primary">Search</button>
        </form>
        {q && (
          <div style={{ marginTop: 8 }}>
            <Link href="/customers" className="small" style={{ color: "var(--pink)" }}>Clear search</Link>
          </div>
        )}
      </section>

      <section className="card">
        {customers.length === 0 ? (
          <p className="small muted" style={{ textAlign: "center", padding: "20px 0" }}>No customers found.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {customers.map(c => {
              const stage = (c as any).stage || "LEAD";
              const repName = (c as any).rep?.name || (c as any).salesRep || null;
              return (
                <Link
                  key={c.id}
                  href={"/customers/" + c.id}
                  style={{ display: "block", textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "#fff", padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 4 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: "0.95rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.salonName || "Unnamed"}
                        </div>
                        <div className="small muted">
                          {c.customerName}
                          {c.town ? " - " + c.town : ""}
                        </div>
                      </div>
                      <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600, background: STAGE_COLOR[stage] || "#f3f4f6", color: STAGE_TEXT[stage] || "#374151", flexShrink: 0 }}>
                        {STAGE_LABEL[stage] || stage}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      {repName && <span className="small muted">{repName}</span>}
                      {c.customerEmailAddress && <span className="small muted">{c.customerEmailAddress}</span>}
                      {c.customerNumber && <span className="small muted">{c.customerNumber}</span>}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
