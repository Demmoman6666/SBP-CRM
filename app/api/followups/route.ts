// app/api/followups/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Parse YYYY-MM-DD → Date
function parseDate(d?: string | null) {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day, 0, 0, 0, 0);
}

function parseReps(param: string | null): string[] {
  if (!param) return [];
  return param.split(",").map(s => s.trim()).filter(Boolean);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from"); // inclusive
  const toStr   = searchParams.get("to");   // exclusive
  const reps    = parseReps(searchParams.get("reps")); // comma-separated names

  let from = parseDate(fromStr);
  let to   = parseDate(toStr);

  // default to current month
  if (!from || !to) {
    const now = new Date();
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  // Build rep filter against CallLog.staff (case-insensitive equals)
  const repWhere = reps.length
    ? { OR: reps.map(r => ({ staff: { equals: r, mode: "insensitive" as const } })) }
    : {};

  const logs = await prisma.callLog.findMany({
    where: {
      followUpAt: { gte: from!, lt: to!, not: null },
      outcome: { equals: "Appointment booked", mode: "insensitive" }, // ← only these
      ...repWhere,
    },
    select: {
      id: true,
      followUpAt: true,
      staff: true,
      summary: true,
      isExistingCustomer: true,
      customerName: true, // when lead
      customer: { select: { id: true, salonName: true, customerName: true } },
    },
    orderBy: { followUpAt: "asc" },
  });

  const items = logs.map((l) => {
    const label = l.isExistingCustomer
      ? (l.customer?.salonName || l.customer?.customerName || "Customer")
      : (l.customerName || "Lead");

    return {
      id: l.id,
      at: l.followUpAt,              // ISO
      staff: l.staff,
      summary: l.summary,
      customerId: l.customer?.id || null,
      customerLabel: label,
      isLead: !l.isExistingCustomer,
    };
  });

  return NextResponse.json(items);
}
