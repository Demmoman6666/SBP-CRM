// app/api/saleshub/calls-geo/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function escapeHtml(s: any) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Accept ?rep=... (preferred) and ?staff=... (compat)
    const repParam =
      searchParams.get("rep")?.trim() ||
      searchParams.get("staff")?.trim() ||
      "";

    const days = Math.min(
      365,
      Math.max(1, Number(searchParams.get("days") || 365))
    );
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Base filters: must have coordinates and be within the lookback window
    const where: any = {
      latitude: { not: null },
      longitude: { not: null },
      createdAt: { gte: since },
    };

    // If a rep is chosen, include calls where either:
    //   - CallLog.staff equals rep (case-insensitive), OR
    //   - The linked Customer.salesRep equals rep (case-insensitive)
    if (repParam) {
      where.AND = [
        {
          OR: [
            { staff: { equals: repParam, mode: "insensitive" } },
            {
              customer: {
                is: { salesRep: { equals: repParam, mode: "insensitive" } },
              },
            },
          ],
        },
      ];
    }

    const logs = await prisma.callLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        staff: true,
        latitude: true,
        longitude: true,
        customer: {
          select: {
            salonName: true,
            salesRep: true,
            town: true,
            postCode: true,
          },
        },
      },
      // You can bump this if you want more than 5k points
      take: 5000,
    });

    const rows = logs
      .map((l) => {
        const lat = Number(l.latitude);
        const lng = Number(l.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

        const rep = l.staff || l.customer?.salesRep || null;
        const title = l.customer?.salonName || "Call";
        const town = l.customer?.town || "";
        const pc = l.customer?.postCode || "";
        const when = new Date(l.createdAt).toLocaleDateString("en-GB");

        const infoHtml = `
          <div style="min-width:220px">
            <strong>${escapeHtml(title)}</strong><br/>
            ${escapeHtml(town)} ${escapeHtml(pc)}<br/>
            Rep: ${escapeHtml(rep)}<br/>
            Date: ${escapeHtml(when)}
          </div>
        `;

        return { lat, lng, rep, infoHtml };
      })
      .filter(Boolean);

    return NextResponse.json({ ok: true, rows });
  } catch (err: any) {
    console.error("GET /api/saleshub/calls-geo failed:", err);
    return NextResponse.json(
      { ok: false, rows: [], error: "Failed to load coverage data" },
      { status: 500 }
    );
  }
}
