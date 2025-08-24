// app/api/reports/calls/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/* Parse yyyy-mm-dd safely */
function parseDay(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
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

    const from = parseDay(fromStr);
    const to = parseDay(toStr);
    if (!from || !to) {
      return NextResponse.json(
        { error: "Invalid or missing from/to (yyyy-mm-dd)" },
        { status: 400 }
      );
    }

    // inclusive [from 00:00, to 23:59:59]
    const gte = from;
    const lt = addDays(to, 1);

    // 🔧 Explicitly type the where clause to avoid circular type errors with groupBy
    const where: Prisma.CallLogWhereInput = { createdAt: { gte, lt } };

    const totalCalls = await prisma.callLog.count({ where });
    const bookings = await prisma.callLog.count({
      where: { ...where, appointmentBooked: true },
    });
    const sales = await prisma.callLog.count({
      where: { ...where, outcome: "Sale" },
    });

    // 🔧 Type-narrow the groupBy call; some Next/TS combos choke on the generic constraints.
    const byRepRaw = (await prisma.callLog.groupBy({
      by: ["staff"],
      where,
      _count: { _all: true },
      orderBy: { _count: { _all: "desc" } },
    } as unknown as Prisma.CallLogGroupByArgs)) as Array<{
      staff: string | null;
      _count: { _all: number };
    }>;

    const callToBookingPct = totalCalls > 0 ? (bookings / totalCalls) * 100 : 0;
    const apptToSalePct = bookings > 0 ? (sales / bookings) * 100 : 0;

    const byRep = byRepRaw.map((r) => ({
      staff: r.staff,
      count: r._count._all,
    }));

    return NextResponse.json({
      range: { from: fromStr, to: toStr },
      totals: {
        totalCalls,
        bookings,
        sales,
        callToBookingPct,
        apptToSalePct,
      },
      byRep,
    });
  } catch (err: any) {
    console.error("Call report error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
