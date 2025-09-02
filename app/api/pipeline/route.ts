// app/api/pipeline/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Stage = "LEAD" | "APPOINTMENT_BOOKED" | "SAMPLING" | "CUSTOMER";

function normStage(input?: string | null): Stage | null {
  if (!input) return null;
  const s = String(input).trim().toUpperCase().replace(/\s+/g, "_");
  if (s === "CUSTOMER" || s === "CLIENT" || s === "EXISTING_CUSTOMER") return "CUSTOMER";
  if (s === "LEAD") return "LEAD";
  if (s === "SAMPLING" || s === "SAMPLE") return "SAMPLING";
  if (s === "APPOINTMENT_BOOKED" || s === "APPT_BOOKED" || s === "APPT") return "APPOINTMENT_BOOKED";
  return null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // Accept ?rep= or ?salesRep=
  const repRaw = searchParams.get("rep") || searchParams.get("salesRep") || "";
  const rep = repRaw && repRaw !== "ALL" && repRaw !== "All reps" ? repRaw : "";
  // Optional: ?stage=LEAD|APPOINTMENT_BOOKED|SAMPLING|CUSTOMER (synonyms normalized)
  const stageFilter = normStage(searchParams.get("stage"));
  // Optional limit for table rows
  const take = Math.min(Math.max(Number(searchParams.get("take") || 200), 1), 500);

  const whereBase: any = {};
  if (rep) whereBase.salesRep = rep;

  // Counts respect Sales Rep filter, but not the stage filter (so you can see the whole breakdown)
  const [lead, appt, sampling, customer, total] = await Promise.all([
    prisma.customer.count({ where: { ...whereBase, stage: "LEAD" } }),
    prisma.customer.count({ where: { ...whereBase, stage: "APPOINTMENT_BOOKED" } }),
    prisma.customer.count({ where: { ...whereBase, stage: "SAMPLING" } }),
    prisma.customer.count({ where: { ...whereBase, stage: "CUSTOMER" } }),
    prisma.customer.count({ where: whereBase }),
  ]);

  // Table rows (apply stage filter if present)
  const whereItems = {
    ...whereBase,
    ...(stageFilter ? { stage: stageFilter } : {}),
  };

  const items = await prisma.customer.findMany({
    where: whereItems,
    orderBy: stageFilter
      ? [{ createdAt: "desc" }]
      : [{ stage: "asc" }, { createdAt: "desc" }],
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
    stageFilter: stageFilter ?? null,
    items: rows,
  });
}
