// app/customers/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type PageProps = {
  searchParams?: { q?: string };
};

export default async function CustomersPage({ searchParams }: PageProps) {
  const q = (searchParams?.q ?? "").trim();

  // helper to keep Prisma typing happy
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
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Customers</h2>
        <Link className="primary" href="/customers/new">
          New Customer
        </Link>
      </div>

      <form className="row" action="/customers" method="get" style={{ gap: 8 }}>
        <input
          type="text"
          name="q"
          placeholder="Search name, email, town…"
          defaultValue={q}
          style={{ flex: 1 }}
        />
        <button type="submit">Search</button>
      </form>

      <div className="card">
        {customers.length === 0 ? (
          <p className="small">No customers found.</p>
        ) : (
          <ul className="list">
            {customers.map((c) => (
              <li
                key={c.id}
                className="row"
                style={{
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: "1px solid #2a2e42",
                }}
              >
                <div>
                  <div>
                    <Link href={`/customers/${c.id}`}>{c.salonName}</Link>
                  </div>
                  <div className="small">
                    {c.customerName}
                    {c.town ? ` • ${c.town}` : ""}
                  </div>
                </div>
                <div className="small" style={{ textAlign: "right" }}>
                  {c.customerEmailAddress ?? "-"}
                  <br />
                  {c.customerNumber ?? "-"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
