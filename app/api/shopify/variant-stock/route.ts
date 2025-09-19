// app/api/shopify/variant-stock/route.ts
import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

// Robustly turn any Shopify id (GID or numeric) into a number
function toNumericId(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v);
  const m = s.match(/(\d+)(?!.*\d)/); // last run of digits
  return m ? Number(m[1]) : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawIds: any[] = Array.isArray(body?.ids) ? body.ids : [];
    const variantIds = rawIds.map(toNumericId).filter((n): n is number => Number.isFinite(n));

    if (variantIds.length === 0) {
      return NextResponse.json({ stock: {} }, { status: 200 });
    }

    // 1) Load variants for inventory_quantity and inventory_item_id
    const qs = encodeURIComponent(variantIds.join(","));
    const res = await shopifyRest(
      `/variants.json?ids=${qs}&fields=id,inventory_quantity,inventory_item_id`,
      { method: "GET" }
    );

    if (!res.ok) {
      // Be tolerant: return empty stock map instead of erroring the UI
      return NextResponse.json({ stock: {} }, { status: 200 });
    }

    const json = await res.json().catch(() => ({}));
    const variants: any[] = Array.isArray(json?.variants) ? json.variants : [];

    const stockByVariantId: Record<string, number> = {};
    const itemIdsNeedingLevels: number[] = [];

    for (const v of variants) {
      const vid = Number(v?.id);
      const invQty = Number(v?.inventory_quantity);
      if (Number.isFinite(invQty)) {
        stockByVariantId[String(vid)] = invQty;
      } else {
        const itemId = Number(v?.inventory_item_id);
        if (Number.isFinite(itemId)) itemIdsNeedingLevels.push(itemId);
      }
    }

    // 2) For multi-location stores, sum inventory levels per inventory_item_id
    if (itemIdsNeedingLevels.length) {
      const idsParam = encodeURIComponent(itemIdsNeedingLevels.join(","));
      const r2 = await shopifyRest(
        `/inventory_levels.json?inventory_item_ids=${idsParam}`,
        { method: "GET" }
      );

      if (r2.ok) {
        const j2 = await r2.json().catch(() => ({}));
        const levels: any[] = Array.isArray(j2?.inventory_levels) ? j2.inventory_levels : [];
        const sumByItem: Record<number, number> = {};

        for (const lvl of levels) {
          const itemId = Number(lvl?.inventory_item_id);
          const available = Number(lvl?.available);
          if (!Number.isFinite(itemId) || !Number.isFinite(available)) continue;
          sumByItem[itemId] = (sumByItem[itemId] ?? 0) + available;
        }

        // Map summed levels back to variant ids
        for (const v of variants) {
          const vid = Number(v?.id);
          const itemId = Number(v?.inventory_item_id);
          if (Number.isFinite(vid) && Number.isFinite(itemId) && sumByItem[itemId] != null) {
            stockByVariantId[String(vid)] = sumByItem[itemId];
          }
        }
      }
    }

    return NextResponse.json({ stock: stockByVariantId }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { stock: {}, error: err?.message || "Failed to fetch stock" },
      { status: 500 }
    );
  }
}
