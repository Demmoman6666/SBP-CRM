// app/api/reports/calls/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic"; // we read search params

/* ---- date helpers (UTC, inclusive range) ---- */
function parseDay(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}
function addDaysUTC(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/* ---- logic helpers ---- */
const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();

function isBooking(log: {
  appointmentBooked?: boolean | null;
  outcome?: string | null;
  callType?: string | null;
  stage?: string | null;
}) {
  if (log.appointmentBooked) return true;
  const out = norm(log.outcome);
  if (out === "appointment booked" || out.startsWith("appointment booked")) return true;
  if ((log.stage ?? "").toUpperCase() === "APPOINTMENT_BOOKED") return true;
  const ct = norm(log.callType);
  if (ct.includes("booked")) return true; // "Booked Call", "Appointment booked", etc
  return false;
}

function isSale(log: { outcome?: string | null }) {
  const out = norm(log.outcome);
  return out === "sale" || out.startsWith("sale");
}

function durationMins(log: {
  durationMinutes?: number | null;
  startTime?: Date | null;
  endTime?: Date | null;
}) {
  if (typeof log.durationMinutes === "number" && !isNaN(log.durationMinutes)) {
    return Math.max(0, log.durationMinutes);
  }
  if (log.startTime && log.endTime) {
    const ms = new Date(log.endTime).getTime() - new Date(log.startTime).getTime();
    if (!isNaN(ms) && ms > 0) return Math.round(ms / 60000);
  }
  return 0;
}

/* ---- route ---- */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    const staff = (searchParams.get("staff") || "").trim(); // optional
    const format = (searchParams.get("format") || "").toLowerCase(); // "csv"

    const from = parseDay(fromStr);
    const to = parseDay(toStr);
    if (!from || !to) {
      return NextResponse.json(
        { error: "Invalid or missing from/to (yyyy-mm-dd)" },
        { status: 400 }
      );
    }

    // Inclusive range: [from 00:00, to 23:59:59.999]
    const gte = from;
    const lt = addDaysUTC(to, 1);

    // Pull JUST the fields we need so we can apply flexible logic client-side
    const logs = await prisma.callLog.findMany({
      where: {
        createdAt: { gte, lt },
        ...(staff ? { staff } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: {
        staff: true,
        createdAt: true,
        callType: true,
        outcome: true,
        appointmentBooked: true,
        stage: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
      },
    });

    const totalCalls = logs.length;

    // Totals
    let bookings = 0;
    let sales = 0;
    let totalDurationMinutes = 0;

    // "Booked Calls" = callType specifically a "Booked Call" (case-insensitive)
    let bookedCalls = 0;
    let bookedCallSales = 0;

    for (const l of logs) {
      const booked = isBooking(l);
      const sale = isSale(l);

      if (booked) bookings++;
      if (sale) sales++;

      const callType = norm(l.callType);
      const isBookedType = callType === "booked call" || callType.includes("booked call");
      if (isBookedType) {
        bookedCalls++;
        if (sale) bookedCallSales++;
      }

      totalDurationMinutes += durationMins(l);
    }

    const callToBookingPct = totalCalls ? (bookings / totalCalls) * 100 : 0;
    const apptToSalePct = bookings ? (sales / bookings) * 100 : 0;
    const callToSalePct = totalCalls ? (sales / totalCalls) * 100 : 0;
    const avgDurationMinutes = totalCalls ? totalDurationMinutes / totalCalls : 0;

    // By-rep table
    const byRepMap = new Map<string, number>();
    for (const l of logs) {
      const key = l.staff || "Unassigned";
      byRepMap.set(key, (byRepMap.get(key) ?? 0) + 1);
    }
    const byRep = Array.from(byRepMap.entries())
      .map(([s, count]) => ({ staff: s, count }))
      .sort((a, b) => b.count - a.count);

    const payload = {
      generatedAt: new Date().toISOString(),
      range: { from: fromStr!, to: toStr! },
      filter: { staff: staff || null },
      totals: {
        totalCalls,
        bookings,
        sales,
        callToBookingPct,
        apptToSalePct,
        callToSalePct,
        bookedCalls,
        bookedCallSales,
        bookedCallToSalePct: bookedCalls ? (bookedCallSales / bookedCalls) * 100 : 0,
        totalDurationMinutes,
        avgDurationMinutes,
      },
      byRep,
    };

    if (format !== "csv") {
      return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
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
        "Appointments Booked",
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
        totalCalls,
        bookings,
        sales,
        callToBookingPct.toFixed(1),
        apptToSalePct.toFixed(1),
        callToSalePct.toFixed(1),
        bookedCalls,
        bookedCallSales,
        (bookedCalls ? (bookedCallSales / bookedCalls) * 100 : 0).toFixed(1),
        Math.round(totalDurationMinutes),
        avgDurationMinutes.toFixed(1),
      ].map(esc).join(",")
    );

    rows.push(""); // blank line
    rows.push(["Sales Rep", "Calls"].map(esc).join(","));
    for (const r of byRep) rows.push([r.staff, r.count].map(esc).join(","));

    const csv = rows.join("\n");
    const headers = new Headers({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="call-report_${payload.range.from}_to_${payload.range.to}.csv"`,
      "Cache-Control": "no-store",
    });
    return new NextResponse(csv, { status: 200, headers });
  } catch (err: any) {
    console.error("Call report error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
