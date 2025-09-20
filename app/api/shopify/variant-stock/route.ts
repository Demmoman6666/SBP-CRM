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

    // First call: get inventory_item_id for each variant, and also grab inventory_quantity as a fallback
    // (Works with products scope. inventory_quantity is a single total across locations.)
    const variantToItem: Record<number, number> = {};
    const variantFallbackQty: Record<number, number> = {};

    const size = 50;
    for (let i = 0; i < variantIds.length; i += size) {
      const slice = variantIds.slice(i, i + size);
      const qs = encodeURIComponent(slice.join(","));
      const res = await shopifyRest(
        `/variants.json?ids=${qs}&fields=id,inventory_item_id,inventory_quantity`,
        { method: "GET" }
      );
      if (!res.ok) continue;

      const json = await res.json().catch(() => ({}));
      const variants: any[] = Array.isArray(json?.variants) ? json.variants : [];
      for (const v of variants) {
        const vid = Number(v?.id);
        const itemId = Number(v?.inventory_item_id);
        if (Number.isFinite(vid)) {
          if (Number.isFinite(itemId)) variantToItem[vid] = itemId;
          // Store the variant-level total as a fallback (works without read_inventory)
          const iq = Number(v?.inventory_quantity);
          if (Number.isFinite(iq)) variantFallbackQty[vid] = iq;
        }
      }
    }

    // If we couldn’t map any inventory items, just return the variant-level totals (if any)
    const itemIds = Object.values(variantToItem);
    if (itemIds.length === 0) {
      // Build response using fallback quantities (if missing, treat as 0)
      const out: Record<string, number> = {};
      for (const vid of variantIds) {
        const qty = Number.isFinite(variantFallbackQty[vid]) ? variantFallbackQty[vid] : 0;
        out[String(vid)] = Number(qty);
      }
      return NextResponse.json({ stock: out, _source: "variants.inventory_quantity" }, { status: 200 });
    }

    // Second call (preferred): Inventory Levels across locations (requires read_inventory).
    // If this 403s or fails, we’ll still return the variant fallback totals.
    const totalsByItem: Record<number, number> = {};
    let levelsWorked = false;

    for (let i = 0; i < itemIds.length; i += size) {
      const slice = itemIds.slice(i, i + size);
      const qs = encodeURIComponent(slice.join(","));
      const res = await shopifyRest(
        `/inventory_levels.json?inventory_item_ids=${qs}`,
        { method: "GET" }
      );

      if (!res.ok) {
        // If forbidden (likely missing read_inventory), stop trying levels.
        if (res.status === 401 || res.status === 403) {
          levelsWorked = false;
          break;
        }
        continue;
      }

      levelsWorked = true;
      const json = await res.json().catch(() => ({}));
      const levels: any[] = Array.isArray(json?.inventory_levels) ? json.inventory_levels : [];
      for (const lvl of levels) {
        const iid = Number(lvl?.inventory_item_id);
        const available = Number(lvl?.available);
        if (!Number.isFinite(iid) || !Number.isFinite(available)) continue;
        totalsByItem[iid] = (totalsByItem[iid] ?? 0) + available;
      }
    }

    // Map back to variant ids. Prefer levels if we got them; otherwise fallback totals.
    const out: Record<string, number> = {};
    for (const vid of variantIds) {
      const iid = variantToItem[vid];
      let qty: number | undefined;

      if (levelsWorked && Number.isFinite(iid)) {
        qty = totalsByItem[iid] ?? 0;
      } else {
        qty = Number.isFinite(variantFallbackQty[vid]) ? variantFallbackQty[vid] : 0;
      }

      out[String(vid)] = Number(qty);
    }

    return NextResponse.json(
      { stock: out, _source: levelsWorked ? "inventory_levels" : "variants.inventory_quantity" },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch variant stock", stock: {} },
      { status: 500 }
    );
  }
}
