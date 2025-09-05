// app/api/customers/[id]/route-plan/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Allow only MON..FRI
const DAY_SET = new Set(["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"]);

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const c = await prisma.customer.findUnique({
    where: { id: params.id },
    select: { id: true, routePlanEnabled: true, routeWeeks: true, routeDays: true },
  });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(c);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const enabled = Boolean(body?.enabled);
  const weeks: number[] = Array.isArray(body?.weeks) ? body.weeks : [];
  const daysRaw: string[] = Array.isArray(body?.days) ? body.days : [];

  // Validate weeks 1..4, unique+sorted
  const w = [...new Set(weeks.filter((n: any) => Number.isInteger(n) && n >= 1 && n <= 4))].sort((a, b) => a - b);
  // Validate days
  const d = [...new Set(daysRaw.map(String).map(s => s.toUpperCase()).filter(s => DAY_SET.has(s)))];

  const updated = await prisma.customer.update({
    where: { id: params.id },
    data: {
      routePlanEnabled: enabled,
      routeWeeks: w,
      routeDays: d as any, // matches Prisma enum
    },
    select: { id: true, routePlanEnabled: true, routeWeeks: true, routeDays: true },
  });

  return NextResponse.json(updated);
}
