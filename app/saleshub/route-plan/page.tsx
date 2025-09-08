// app/saleshub/route-plan/page.tsx
import { prisma } from "@/lib/prisma";
import RoutePlanClient from "@/components/RoutePlanClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RoutePlanPage() {
  const reps = await prisma.salesRep.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Route Plan</h1>
        <p className="small">Pick a sales rep, week, and day to see the planned salons and send the route to Google Maps.</p>
      </section>

      <RoutePlanClient reps={reps} />
    </div>
  );
}
