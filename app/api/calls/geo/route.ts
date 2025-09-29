import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/calls/geo?rep=<name>&days=<n>
 * - rep: optional exact match of SalesRep (CallLog.staff OR linked Customer.salesRep)
 * - days: optional integer window (defaults 90)
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const rep = (sp.get("rep") || "").trim() || null;
    const days = Math.max(1, Math.min(Number(sp.get("days") || "90"), 365));

    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    const where: any = {
      latitude: { not: null },
      longitude: { not: null },
      createdAt: { gte: start, lte: end },
    };

    if (rep) {
      // match either the call's staff field or the linked customer's salesRep
      where.OR = [
        { staff: rep },
        { customer: { is: { salesRep: rep } } },
      ];
    }

    const logs = await prisma.callLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        staff: true,
        summary: true,
        outcome: true,
        latitude: true,
        longitude: true,
        customer: { select: { id: true, salonName: true } },
      },
      take: 5000, // sensible cap
    });

    const points = logs.map(l => ({
      id: l.id,
      lat: Number(l.latitude),
      lng: Number(l.longitude),
      time: l.createdAt,
      rep: l.staff || l.customer?.salonName || null,
      staff: l.staff || null,
      customerId: l.customer?.id || null,
      customerName: l.customer?.salonName || "Unknown",
      summary: l.summary || "",
      outcome: l.outcome || "",
    }));

    return NextResponse.json({ ok: true, points, windowDays: days });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
