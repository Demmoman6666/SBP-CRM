// app/api/shopify/variant-stock/route.ts
import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

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

    // 1) Map variantId -> inventory_item_id
    const variantToItem: Record<number, number> = {};
    const size = 50;
    for (let i = 0; i < variantIds.length; i += size) {
      const slice = variantIds.slice(i, i + size);
      const qs = encodeURIComponent(slice.join(","));
      const res = await shopifyRest(
        `/variants.json?ids=${qs}&fields=id,inventory_item_id`,
        { method: "GET" }
      );
      if (!res.ok) continue;
      const json = await res.json().catch(() => ({}));
      const variants: any[] = Array.isArray(json?.variants) ? json.variants : [];
      for (const v of variants) {
        const vid = Number(v?.id);
        const itemId = Number(v?.inventory_item_id);
        if (Number.isFinite(vid) && Number.isFinite(itemId)) {
          variantToItem[vid] = itemId;
        }
      }
    }

    const itemIds = Object.values(variantToItem);
    if (itemIds.length === 0) {
      return NextResponse.json({ stock: {} }, { status: 200 });
    }

    // 2) Get inventory levels for those inventory_item_ids (sum across locations)
    const itemTotals: Record<number, number> = {};
    for (let i = 0; i < itemIds.length; i += size) {
      const slice = itemIds.slice(i, i + size);
      const qs = encodeURIComponent(slice.join(","));
      const res = await shopifyRest(
        `/inventory_levels.json?inventory_item_ids=${qs}`,
        { method: "GET" }
      );
      if (!res.ok) continue;
      const json = await res.json().catch(() => ({}));
      const levels: any[] = Array.isArray(json?.inventory_levels) ? json.inventory_levels : [];
      for (const lvl of levels) {
        const iid = Number(lvl?.inventory_item_id);
        const available = Number(lvl?.available);
        if (!Number.isFinite(iid)) continue;
        if (!Number.isFinite(available)) continue;
        itemTotals[iid] = (itemTotals[iid] ?? 0) + available;
      }
    }

    // 3) Map back to variant ids
    const out: Record<string, number> = {};
    for (const [vidStr, iid] of Object.entries(variantToItem)) {
      const vid = Number(vidStr);
      const qty = itemTotals[iid] ?? 0;
      out[String(vid)] = qty;
    }

    return NextResponse.json({ stock: out }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch variant stock", stock: {} },
      { status: 500 }
    );
  }
}
