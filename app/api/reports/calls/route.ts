// app/api/reports/calls/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // required because we read request.url (search params)

/* Parse yyyy-mm-dd safely (UTC) */
function parseDay(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}
function addDaysUTC(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    const staff = (searchParams.get("staff") || "").trim(); // optional filter
    const format = (searchParams.get("format") || "").toLowerCase(); // "csv" to export

    const from = parseDay(fromStr);
    const to = parseDay(toStr);
    if (!from || !to) {
      return NextResponse.json(
        { error: "Invalid or missing from/to (yyyy-mm-dd)" },
        { status: 400 }
      );
    }

    // inclusive range: [from 00:00, to 23:59:59]
    const gte = from;
    const lt = addDaysUTC(to, 1);

    const where: Prisma.CallLogWhereInput = {
      createdAt: { gte, lt },
      ...(staff ? { staff } : {}),
    };

    // Totals
    const [totalCalls, bookings, sales] = await Promise.all([
      prisma.callLog.count({ where }),
      prisma.callLog.count({ where: { ...where, appointmentBooked: true } }),
      prisma.callLog.count({ where: { ...where, outcome: "Sale" } }),
    ]);

    // Durations: sum only; average = totalDuration / totalCalls (treat missing as 0)
    const durationAgg = await prisma.callLog.aggregate({
      where,
      _sum: { durationMinutes: true },
    });
    const totalDurationMinutes = durationAgg._sum.durationMinutes ?? 0;
    const avgDurationMinutes =
      totalCalls > 0 ? totalDurationMinutes / totalCalls : 0;

    // Booked Calls (callType = "Booked Call") and how many became sales
    const [bookedCalls, bookedCallSales] = await Promise.all([
      prisma.callLog.count({ where: { ...where, callType: "Booked Call" } }),
      prisma.callLog.count({
        where: { ...where, callType: "Booked Call", outcome: "Sale" },
      }),
    ]);

    // By-rep counts (avoid groupBy TS typing pitfalls)
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

    // JSON payload (default)
    const payload = {
      generatedAt: new Date().toISOString(),
      range: { from: fromStr!, to: toStr! },
      filter: { staff: staff || null },
      totals: {
        totalCalls,
        bookings,
        sales,
        callToBookingPct: totalCalls > 0 ? (bookings / totalCalls) * 100 : 0,
        apptToSalePct: bookings > 0 ? (sales / bookings) * 100 : 0,
        callToSalePct: totalCalls > 0 ? (sales / totalCalls) * 100 : 0,
        bookedCalls,
        bookedCallSales,
        bookedCallToSalePct:
          bookedCalls > 0 ? (bookedCallSales / bookedCalls) * 100 : 0,
        totalDurationMinutes,
        avgDurationMinutes,
      },
      byRep,
    };

    if (format !== "csv") {
      return NextResponse.json(payload);
    }

    // ---------- CSV export ----------
    const rows: string[] = [];
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    // Overview header
    rows.push(
      [
        "From",
        "To",
        "Staff Filter",
        "Total Calls",
        "Bookings",
        "Sales",
        "Call→Booking %",
        "Booking→Sale %",
        "Call→Sale %",
        "Booked Calls",
        "Booked Calls → Sales",
        "Booked Calls → Sale %",
        "Total Duration (mins)",
        "Average Duration (mins)",
      ].map(esc).join(",")
    );

    // Overview data
    rows.push(
      [
        payload.range.from,
        payload.range.to,
        staff || "All",
        payload.totals.totalCalls,
        payload.totals.bookings,
        payload.totals.sales,
        payload.totals.callToBookingPct.toFixed(1),
        payload.totals.apptToSalePct.toFixed(1),
        payload.totals.callToSalePct.toFixed(1),
        payload.totals.bookedCalls,
        payload.totals.bookedCallSales,
        payload.totals.bookedCallToSalePct.toFixed(1),
        Math.round(payload.totals.totalDurationMinutes),
        payload.totals.avgDurationMinutes.toFixed(1),
      ].map(esc).join(",")
    );

    // Blank line
    rows.push("");

    // Per-rep table
    rows.push(["Sales Rep", "Calls"].map(esc).join(","));
    for (const r of payload.byRep) {
      rows.push([r.staff, r.count].map(esc).join(","));
    }

    const csv = rows.join("\n");

    const headers = new Headers();
    headers.set("Content-Type", "text/csv; charset=utf-8");
    headers.set(
      "Content-Disposition",
      `attachment; filename="call-report_${payload.range.from}_to_${payload.range.to}.csv"`
    );

    return new NextResponse(csv, { status: 200, headers });
  } catch (err: any) {
    console.error("Call report error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
