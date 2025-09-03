// app/api/admin/backfill-call-times/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const updated = await prisma.$executeRawUnsafe(`
      UPDATE "CallLog"
      SET
        "endTime"   = COALESCE("endTime", "createdAt"),
        "startTime" = COALESCE(
          "startTime",
          COALESCE("endTime", "createdAt") - (COALESCE("durationMinutes", 0) || ' minutes')::interval
        )
      WHERE "startTime" IS NULL OR "endTime" IS NULL;
    `);
    return NextResponse.json({ ok: true, updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
