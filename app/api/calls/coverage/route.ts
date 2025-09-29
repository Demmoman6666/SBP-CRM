import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/calls/coverage?repId=<optional>
 * Returns: { ok: true, points: Array<{ id, customerName, latitude, longitude, repId, repName, createdAt }> }
 *
 * Notes:
 * - Filters to calls that have latitude & longitude.
 * - If repId is provided, we resolve the SalesRep name and filter CallLog.staff == that name.
 *   (Your schema doesn't link CallLog -> SalesRep, so staff name is our best filter.)
 */
export async function GET(req: NextRequest) {
  try {
    const repId = req.nextUrl.searchParams.get("repId") || "";
    let repName: string | null = null;

    if (repId) {
      const rep = await prisma.salesRep.findUnique({
        where: { id: repId },
        select: { name: true },
      });
      repName = rep?.name ?? null;
    }

    const where: any = {
      latitude: { not: null },
      longitude: { not: null },
    };
    if (repName) where.staff = repName;

    const rows = await prisma.callLog.findMany({
      where,
      select: {
        id: true,
        customerName: true,
        latitude: true,
        longitude: true,
        staff: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5000, // cap to something reasonable
    });

    const points = rows.map((r) => ({
      id: r.id,
      customerName: r.customerName ?? null,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      repId: repId || null,
      repName: r.staff ?? null,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ ok: true, points });
  } catch (err: any) {
    console.error("GET /api/calls/coverage failed:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to load coverage" },
      { status: 500 }
    );
  }
}
