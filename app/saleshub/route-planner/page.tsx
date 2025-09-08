// app/saleshub/route-planner/page.tsx
import { prisma } from "@/lib/prisma";
import RoutePlannerClient from "@/components/RoutePlannerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RoutePlannerPage() {
  // Build Sales Rep chip list from distinct Customer.salesRep values
  const repsRaw = await prisma.customer.findMany({
    where: { salesRep: { not: null } },
    select: { salesRep: true },
    distinct: ["salesRep"],
    orderBy: { salesRep: "asc" },
  });

  const reps = repsRaw
    .map(r => r.salesRep?.trim())
    .filter((x): x is string => !!x);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Route Planner</h1>
        <p className="small">
          Filter customers by <strong>Sales Rep</strong> and <strong>postcode prefix</strong> (e.g. IP1, IP14, CF8, CF43),
          then export or copy addresses.
        </p>
      </section>

      <RoutePlannerClient reps={reps} />
    </div>
  );
}
