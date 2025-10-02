// app/api/admin/backfill-variant-costs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchVariantCostsOnce } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number(sp.get("limit") || 1000), 1), 5000);

    // 1) Distinct variantIds used in OrderLineItem
    const raw = await prisma.orderLineItem.findMany({
      where: { variantId: { not: null } },
      select: { variantId: true },
      distinct: ["variantId"],
      take: limit,
    });

    const allVariantIds = raw.map(r => String(r.variantId)).filter(Boolean);

    if (allVariantIds.length === 0) {
      return NextResponse.json({ ok: true, scanned: 0, upserts: 0, message: "No variantIds found." });
    }

    // 2) Which ones are already cached?
    const cached = await prisma.shopifyVariantCost.findMany({
      where: { variantId: { in: allVariantIds } },
      select: { variantId: true },
    });
    const cachedSet = new Set(cached.map(c => c.variantId));
    const missing = allVariantIds.filter(id => !cachedSet.has(id));

    if (missing.length === 0) {
      return NextResponse.json({ ok: true, scanned: allVariantIds.length, upserts: 0, message: "All variant costs already cached." });
    }

    // 3) Batch in chunks of 50 (Shopify nodes limit)
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 50) chunks.push(missing.slice(i, i + 50));

    let upserts = 0;
    for (const chunk of chunks) {
      const map = await fetchVariantCostsOnce(chunk); // Map<numericVariantId, { unitCost, currency, inventoryItemId }>
      for (const id of chunk) {
        const entry = map.get(String(id));
        if (!entry) continue;
        await prisma.shopifyVariantCost.upsert({
          where: { variantId: String(id) },
          create: {
            variantId: String(id),
            inventoryItemId: entry.inventoryItemId ?? null,
            unitCost: entry.unitCost ?? null,
            currency: entry.currency ?? "GBP",
          },
          update: {
            inventoryItemId: entry.inventoryItemId ?? null,
            unitCost: entry.unitCost ?? null,
            currency: entry.currency ?? "GBP",
          },
        });
        upserts++;
      }
    }

    return NextResponse.json({ ok: true, scanned: allVariantIds.length, upserts });
  } catch (e: any) {
    console.error("backfill-variant-costs error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}
