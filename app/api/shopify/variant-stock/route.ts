// app/api/shopify/variant-stock/route.ts
import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

// Parse incoming ids, preserving whether it's a Product or Variant GID/ID
function parseId(v: any): { type: "Product" | "ProductVariant" | "Unknown"; id: number } | null {
  if (v == null) return null;
  const s = String(v);
  const m = s.match(/gid:\/\/shopify\/(ProductVariant|Product)\/(\d+)/i);
  if (m) return { type: m[1] as any, id: Number(m[2]) };
  const lastDigits = s.match(/(\d+)(?!.*\d)/)?.[1];
  if (!lastDigits) return null;
  // We don't know if those digits are product or variant; treat as Unknown (we'll expand products we detect below)
  return { type: "Unknown", id: Number(lastDigits) };
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";

    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body?.ids) ? body.ids : [];

    const parsed = raw.map(parseId).filter(Boolean) as Array<{ type: string; id: number }>;
    const explicitProductIds = parsed.filter(x => x.type === "Product").map(x => x.id);
    let variantIds = parsed.filter(x => x.type === "ProductVariant" || x.type === "Unknown").map(x => x.id);

    // If any Product IDs were provided, expand them to Variant IDs first
    if (explicitProductIds.length) {
      const size = 50;
      for (let i = 0; i < explicitProductIds.length; i += size) {
        const slice = explicitProductIds.slice(i, i + size);
        const res = await shopifyRest(
          `/products.json?ids=${slice.join(",")}&fields=id,variants`,
          { method: "GET" }
        );
        if (!res.ok) continue;
        const json = await res.json().catch(() => ({}));
        const products: any[] = Array.isArray(json?.products) ? json.products : [];
        for (const p of products) {
          for (const v of p?.variants ?? []) {
            const vid = Number(v?.id);
            if (Number.isFinite(vid)) variantIds.push(vid);
          }
        }
      }
    }

    // De-dupe & ensure numeric
    variantIds = Array.from(new Set(variantIds.filter(Number.isFinite)));

    if (variantIds.length === 0) {
      return NextResponse.json(
        { stock: {}, _source: "none", _diagnostics: { reason: "No variant IDs resolved from input" } },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    const size = 50;
    const variantToItem: Record<number, number> = {};
    const variantFallbackQty: Record<number, number | null> = {}; // null = unknown (field absent)
    let levelsWorked = false;
    let levelsForbidden = false;

    // 1) Map Variant → Inventory Item, and capture variants.inventory_quantity as a fallback
    for (let i = 0; i < variantIds.length; i += size) {
      const slice = variantIds.slice(i, i + size);
      const res = await shopifyRest(
        `/variants.json?ids=${slice.join(",")}&fields=id,inventory_item_id,inventory_quantity`,
        { method: "GET" }
      );
      if (!res.ok) continue;

      const json = await res.json().catch(() => ({}));
      const variants: any[] = Array.isArray(json?.variants) ? json.variants : [];
      for (const v of variants) {
        const vid = Number(v?.id);
        const itemId = Number(v?.inventory_item_id);
        if (Number.isFinite(vid) && Number.isFinite(itemId)) variantToItem[vid] = itemId;

        // inventory_quantity may be missing on newer API versions → record null (unknown)
        if (Number.isFinite(vid)) {
          const hasField = typeof v?.inventory_quantity !== "undefined";
          variantFallbackQty[vid] = hasField && Number.isFinite(Number(v.inventory_quantity))
            ? Number(v.inventory_quantity)
            : null;
        }
      }
    }

    const itemIds = Object.values(variantToItem);
    const totalsByItem: Record<number, number> = {};

    // 2) Preferred: inventory levels across locations (requires read_inventory)
    if (itemIds.length) {
      for (let i = 0; i < itemIds.length; i += size) {
        const slice = itemIds.slice(i, i + size);
        const res = await shopifyRest(
          `/inventory_levels.json?inventory_item_ids=${slice.join(",")}`,
          { method: "GET" }
        );
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            levelsForbidden = true;
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
    }

    // 3) Build output
    const out: Record<string, number | null> = {};
    for (const vid of variantIds) {
      const iid = variantToItem[vid];

      if (levelsWorked && Number.isFinite(iid)) {
        out[String(vid)] = totalsByItem[iid] ?? 0; // levels → 0 if no row came back
      } else {
        // Honest fallback: use variants.inventory_quantity if present; else null (unknown)
        if (Object.prototype.hasOwnProperty.call(variantFallbackQty, vid)) {
          out[String(vid)] = variantFallbackQty[vid]; // number or null
        } else {
          out[String(vid)] = null;
        }
      }
    }

    return NextResponse.json(
      {
        stock: out,
        _source: levelsWorked ? "inventory_levels" : "variants.inventory_quantity (fallback)",
        _diagnostics: {
          input: { rawCount: raw.length, parsed: parsed.length },
          expandedFromProducts: explicitProductIds.length,
          resolvedVariantIds: variantIds.length,
          mappedItems: itemIds.length,
          levelsWorked,
          levelsForbidden, // true → token is missing read_inventory scope
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch variant stock", stock: {} },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
