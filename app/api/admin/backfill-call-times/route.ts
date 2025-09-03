export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// One-time backfill: recompute durationMinutes (if missing) from start/end,
// and normalize appointmentBooked from outcome/callType/stage.
// NOTE: we cannot reconstruct startTime/endTime for old rows that never saved them.
async function runBackfill() {
  const rows = await prisma.callLog.findMany({
    where: {
      OR: [
        { durationMinutes: null },
        { appointmentBooked: null },
      ],
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      durationMinutes: true,
      callType: true,
      outcome: true,
      stage: true,
      appointmentBooked: true,
    },
    take: 5000,
  });

  let updated = 0;

  for (const r of rows) {
    // recompute duration if possible
    let newDuration = r.durationMinutes ?? null;
    if ((newDuration == null || newDuration <= 0) && r.startTime && r.endTime) {
      const ms = new Date(r.endTime).getTime() - new Date(r.startTime).getTime();
      if (!Number.isNaN(ms) && ms > 0) {
        newDuration = Math.max(1, Math.round(ms / 60000));
      }
    }

    // normalize "appointment booked"
    const apptBooked =
      r.outcome === "Appointment booked" ||
      r.callType === "Booked Call" ||
      r.stage === "APPOINTMENT_BOOKED";

    const data: Record<string, any> = {};
    if (newDuration != null && newDuration !== r.durationMinutes) data.durationMinutes = newDuration;
    if (r.appointmentBooked !== apptBooked) data.appointmentBooked = apptBooked;

    if (Object.keys(data).length > 0) {
      await prisma.callLog.update({ where: { id: r.id }, data });
      updated++;
    }
  }

  return { ok: true as const, scanned: rows.length, updated };
}

// POST (for your console fetch)
export async function POST() {
  const result = await runBackfill();
  return NextResponse.json(result);
}

// Optional: GET ?run=1 so you can run it by visiting the URL
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("run") !== "1") {
    return NextResponse.json(
      { ok: false, error: "Add ?run=1 or POST to this URL" },
      { status: 400 }
    );
  }
  const result = await runBackfill();
  return NextResponse.json(result);
}
