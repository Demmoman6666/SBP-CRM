import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/* Parse yyyy-mm-dd safely (UTC) */
function parseDay(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    const staff = (searchParams.get("staff") || "").trim(); // optional rep filter

    const from = parseDay(fromStr);
    const to = parseDay(toStr);
    if (!from || !to) {
      return NextResponse.json(
        { error: "Invalid or missing from/to (yyyy-mm-dd)" },
        { status: 400 }
      );
    }

    // inclusive [from 00:00, to 23:59:59)
    const gte = from;
    const lt = addDays(to, 1);

    const where: Prisma.CallLogWhereInput = { createdAt: { gte, lt } };
    if (staff) where.staff = staff;

    // Totals
    const [totalCalls, bookings, sales, bookedCalls, bookedCallSales] =
      await Promise.all([
        prisma.callLog.count({ where }),
        prisma.callLog.count({ where: { ...where, appointmentBooked: true } }),
        prisma.callLog.count({ where: { ...where, outcome: "Sale" } }),
        prisma.callLog.count({ where: { ...where, callType: "Booked Call" } }),
        prisma.callLog.count({
          where: { ...where, callType: "Booked Call", outcome: "Sale" },
        }),
      ]);

    // Calls by rep (simple count)
    const reps = await prisma.callLog.findMany({
      where,
      select: { staff: true },
    });
    const counts = new Map<string, number>();
    for (const r of reps) {
      const key = r.staff ?? "Unassigned";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const byRep = Array.from(counts.entries())
      .map(([s, count]) => ({ staff: s, count }))
      .sort((a, b) => b.count - a.count);

    // Ratios
    const callToBookingPct = totalCalls > 0 ? (bookings / totalCalls) * 100 : 0;
    const apptToSalePct = bookings > 0 ? (sales / bookings) * 100 : 0;
    const callToSalePct = totalCalls > 0 ? (sales / totalCalls) * 100 : 0;
    const bookedCallToSalePct =
      bookedCalls > 0 ? (bookedCallSales / bookedCalls) * 100 : 0;

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      range: { from: fromStr, to: toStr },
      filter: { staff: staff || null },
      totals: {
        totalCalls,
        bookings,
        sales,
        callToBookingPct,
        apptToSalePct,
        callToSalePct,          // ✅ NEW
        bookedCalls,            // ✅ NEW
        bookedCallSales,        // ✅ NEW
        bookedCallToSalePct,    // ✅ NEW
      },
      byRep,
    });
  } catch (err: any) {
    console.error("Call report error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
