// app/api/pipeline/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Stage = "LEAD" | "APPOINTMENT_BOOKED" | "SAMPLING" | "CUSTOMER";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  // Accept ?rep=<rep name> or ?salesRep=<rep name>
  const rep = searchParams.get("rep") || searchParams.get("salesRep") || "";
  // Optional limit (for table rows)
  const take = Math.min(Math.max(Number(searchParams.get("take") || 200), 1), 500);

  const whereBase: any = {};
  if (rep) whereBase.salesRep = rep;

  // Counts per stage
  const [lead, appt, sampling, customer, total] = await Promise.all([
    prisma.customer.count({ where: { ...whereBase, stage: "LEAD" } as any }),
    prisma.customer.count({ where: { ...whereBase, stage: "APPOINTMENT_BOOKED" } as any }),
    prisma.customer.count({ where: { ...whereBase, stage: "SAMPLING" } as any }),
    prisma.customer.count({ where: { ...whereBase, stage: "CUSTOMER" } as any }),
    prisma.customer.count({ where: whereBase }),
  ]);

  // Items for the table
  const items = await prisma.customer.findMany({
    where: whereBase,
    orderBy: [{ stage: "asc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      salonName: true,
      customerName: true,
      salesRep: true,
      stage: true,
      createdAt: true,
    },
  });

  // Normalize to client shape
  const rows = items.map((c) => ({
    id: c.id,
    salonName: c.salonName,
    customerName: c.customerName,
    salesRep: c.salesRep,
    stage: (c.stage as Stage) ?? "LEAD",
    createdAt: c.createdAt.toISOString(),
  }));

  return NextResponse.json({
    counts: {
      LEAD: lead,
      APPOINTMENT_BOOKED: appt,
      SAMPLING: sampling,
      CUSTOMER: customer,
      total,
    },
    items: rows,
  });
}
