// app/customers/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams?: { q?: string } }) {
  const q = (searchParams?.q ?? "").trim();

  const where = q
    ? {
        OR: [
          { salonName: { contains: q, mode: "insensitive" } },
          { customerName: { contains: q, mode: "insensitive" } },
          { customerEmailAddress: { contains: q, mode: "insensitive" } },
          { town: { contains: q, mode: "insensitive" } },
          { county: { contains: q, mode: "insensitive" } },
          { postCode: { contains: q, mode: "insensitive" } },
          { brandsInterestedIn: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const customers = await prisma.customer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <form className="row" style={{ gap: 8 }} action="/customers" method="GET">
          <input name="q" placeholder="Search by salon, person, email, town…" defaultValue={q} />
          <button type="submit">Search</button>
          <Link className="button" href="/customers/new">New Customer</Link>
        </form>
      </div>

      <div className="card">
        <h3>Results ({customers.length})</h3>
        {customers.length === 0 ? (
          <p className="small">No customers found.</p>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {customers.map((c) => (
              <div key={c.id} className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                <div>
                  <div><b>{c.salonName}</b> — {c.customerName}</div>
                  <div className="small">{c.customerEmailAddress || "-"} • {c.town || "-"} {c.postCode ? `• ${c.postCode}` : ""}</div>
                </div>
                <Link className="button" href={`/customers/${c.id}`}>Open</Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
