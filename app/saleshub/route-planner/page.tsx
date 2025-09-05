// app/saleshub/route-planner/page.tsx
import { prisma } from "@/lib/prisma";
import RoutePlannerClient from "@/components/RoutePlannerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RoutePlannerPage() {
  // Populate Sales Rep filter with distinct values already on Customers
  const reps = await prisma.customer.findMany({
    where: { salesRep: { not: null } },
    select: { salesRep: true },
    distinct: ["salesRep"],
    orderBy: { salesRep: "asc" },
  });

  const repOptions = reps
    .map(r => r.salesRep)
    .filter((x): x is string => !!x);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Route Planner</h1>
        <p className="small">
          Filter customers by <strong>Sales Rep</strong> and <strong>postcode prefix</strong> (e.g. <code>IP1</code>, <code>IP14</code>, <code>CF8</code>, <code>CF43</code>), then export or copy addresses.
        </p>
      </section>

      <RoutePlannerClient reps={repOptions} />
    </div>
  );
}
