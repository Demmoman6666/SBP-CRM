// app/customers/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export default async function CustomersPage({
  searchParams,
}: { searchParams?: { q?: string } }) {
  const q = (searchParams?.q ?? "").trim();

  let where: Prisma.CustomerWhereInput = {};
  if (q) {
    const ic = "insensitive" as const; // Prisma.QueryMode
    where = {
      OR: [
        { salonName:            { contains: q, mode: ic } },
        { customerName:         { contains: q, mode: ic } },
        { customerEmailAddress: { contains: q, mode: ic } },
        { town:                 { contains: q, mode: ic } },
        { county:               { contains: q, mode: ic } },
        { postCode:             { contains: q, mode: ic } },
        { brandsInterestedIn:   { contains: q, mode: ic } },
      ],
    };
  }

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

      <form action="/customers" method="get" className="row" style={{ gap: 8 }}>
        <input
          name="q"
          placeholder="Search name, email, town…"
          defaultValue={q}
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
                    <Link href={`/customers/${c.id}`} className="link">
                      {c.salonName}
                    </Link>
                  </div>
