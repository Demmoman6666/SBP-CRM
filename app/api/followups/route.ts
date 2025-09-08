// app/api/followups/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Parse YYYY-MM-DD → Date (start of day, local server time)
function parseDate(d?: string | null) {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day, 0, 0, 0, 0);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from"); // YYYY-MM-DD (inclusive)
  const toStr = searchParams.get("to");     // YYYY-MM-DD (exclusive)

  let from = parseDate(fromStr);
  let to = parseDate(toStr);

  // Default: current month [monthStart, nextMonthStart)
  if (!from || !to) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    from = monthStart;
    to = nextMonthStart;
  }

  const logs = await prisma.callLog.findMany({
    where: {
      followUpAt: { gte: from!, lt: to! },
      // we only care about booked follow-ups (date present)
      // followUpRequired can be true/false; the presence of followUpAt is the source of truth
      // Optionally uncomment if you want both:
      // followUpRequired: true,
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
      at: l.followUpAt,              // ISO Date
      staff: l.staff,
      summary: l.summary,
      customerId: l.customer?.id || null,
      customerLabel: label,
      isLead: !l.isExistingCustomer,
    };
  });

  return NextResponse.json(items);
}
