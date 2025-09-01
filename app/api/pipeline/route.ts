// app/api/pipeline/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Stage = "LEAD" | "APPOINTMENT_BOOKED" | "SAMPLING" | "CUSTOMER";

function normalizeStage(input?: string | null): Stage | null {
  if (!input) return null;
  const s = input.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (s === "lead") return "LEAD";
  if (s === "appointment booked") return "APPOINTMENT_BOOKED";
  if (s === "sampling") return "SAMPLING";
  if (s === "customer") return "CUSTOMER";
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const stageParam = url.searchParams.get("stage");
  const stage = normalizeStage(stageParam);
  const take = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 200);

  const where = stage ? { stage } : {};

  const [customers, lead, appt, sampling, cust] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        id: true,
        salonName: true,
        customerName: true,
        salesRep: true,
        stage: true,
        updatedAt: true,
      },
    }),
    prisma.customer.count({ where: { stage: "LEAD" } }),
    prisma.customer.count({ where: { stage: "APPOINTMENT_BOOKED" } }),
    prisma.customer.count({ where: { stage: "SAMPLING" } }),
    prisma.customer.count({ where: { stage: "CUSTOMER" } }),
  ]);

  return NextResponse.json({
    summary: {
      LEAD: lead,
      APPOINTMENT_BOOKED: appt,
      SAMPLING: sampling,
      CUSTOMER: cust,
    },
    customers,
  });
}
