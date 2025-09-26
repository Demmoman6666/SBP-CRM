// app/api/shopify/oos-days-by-sku/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = { skus: string[]; days?: number; locationId?: string | null };

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function POST(req: NextRequest) {
  try {
    const body: Body = await req.json().catch(() => ({ skus: [] }));
    const skus = Array.isArray(body?.skus) ? body.skus.map(s => String(s).trim()).filter(Boolean) : [];
    const windowDays = Math.max(1, Math.min(Number(body?.days ?? 60), 365));
    const locationId = (typeof body?.locationId === "string" && body.locationId.trim())
      ? body.locationId.trim()
      : undefined;

    if (!skus.length) {
      return NextResponse.json({ ok: true, days: {}, windowStart: null, windowEnd: null, locationScoped: !!locationId });
    }

    // Window is inclusive of 'today' if you already snapped today.
    const today = startOfUtcDay(new Date());
    const start = new Date(today);
    start.setUTCDate(today.getUTCDate() - (windowDays - 1));

    // If a locationId is provided, filter to it; otherwise sum across all locations.
    // We group by (sku, date) and sum 'available' so multi-location shops are handled.
    const grouped = await prisma.inventoryDay.groupBy({
      by: ["sku", "date"],
      where: {
        sku: { in: skus },
        date: { gte: start, lte: today },
        ...(locationId ? { locationId } : {}), // exact location when requested
      },
      _sum: { available: true },
    });

    // Count OOS days = number of distinct dates where summed availability <= 0.
    const oosDaysBySku: Record<string, number> = Object.fromEntries(skus.map(s => [s, 0]));

    for (const g of grouped) {
      const sku = g.sku;
      const sumAvail = Number(g._sum.available ?? 0);
      if (sumAvail <= 0) {
        oosDaysBySku[sku] = (oosDaysBySku[sku] ?? 0) + 1;
      }
    }

    return NextResponse.json({
      ok: true,
      days: oosDaysBySku,
      windowStart: start.toISOString().slice(0, 10),
      windowEnd: today.toISOString().slice(0, 10),
      locationScoped: !!locationId,
      source: "snapshots",
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
