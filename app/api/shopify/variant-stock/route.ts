import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

/** Parse incoming id; keep whether it's a Product or ProductVariant when it's a GID */
function parseId(v: any): { kind: "Product" | "ProductVariant" | "Unknown"; id: number } | null {
  if (v == null) return null;
  const s = String(v);
  const m = s.match(/gid:\/\/shopify\/(ProductVariant|Product)\/(\d+)/i);
  if (m) return { kind: m[1] as any, id: Number(m[2]) };
  const last = s.match(/(\d+)(?!.*\d)/)?.[1];
  if (!last) return null;
  return { kind: "Unknown", id: Number(last) };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body?.ids) ? body.ids : [];
    const parsed = raw.map(parseId).filter(Boolean) as { kind: string; id: number }[];

    // split by type
    const productIds = parsed.filter(p => p.kind === "Product").map(p => p.id);
    let variantIds  = parsed.filter(p => p.kind !== "Product").map(p => p.id);

    const diagnostics: any = { rawCount: raw.length, parsed: parsed.length, expandedFromProducts: 0 };

    // Expand product -> variant ids (if any product ids were sent)
    if (productIds.length) {
      const size = 50;
      for (let i = 0; i < productIds.length; i += size) {
        const slice = productIds.slice(i, i + size);
        const res = await shopifyRest(`/products.json?ids=${slice.join(",")}&fields=id,variants`, { method: "GET" });
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
      diagnostics.expandedFromProducts = productIds.length;
    }

    // dedupe
    variantIds = Array.from(new Set(variantIds.filter(Number.isFinite)));
    if (variantIds.length === 0) {
      return NextResponse.json(
        { stock: {}, _source: "none", _diagnostics: { ...diagnostics, reason: "No variant IDs resolved" } },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 1) Map variant -> inventory_item_id (+ weak fallback qty)
    const variantToItem: Record<number, number> = {};
    const variantFallbackQty: Record<number, number | null> = {};
    const size = 50;

    // batch first
    const idsMissed: number[] = [];
    for (let i = 0; i < variantIds.length; i += size) {
      const slice = variantIds.slice(i, i + size);
      const res = await shopifyRest(
        `/variants.json?ids=${slice.join(",")}&fields=id,inventory_item_id,inventory_quantity`,
        { method: "GET" }
      );
      if (!res.ok) {
        // if batch fails (rare), try one-by-one below
        idsMissed.push(...slice);
        continue;
      }
      const json = await res.json().catch(() => ({}));
      const variants: any[] = Array.isArray(json?.variants) ? json.variants : [];

      // track which from slice we saw
      const seen = new Set<number>();

      for (const v of variants) {
        const vid = Number(v?.id);
        const itemId = Number(v?.inventory_item_id);
        if (Number.isFinite(vid)) seen.add(vid);
        if (Number.isFinite(vid) && Number.isFinite(itemId)) variantToItem[vid] = itemId;

        // inventory_quantity may be missing on newer API versions; null = unknown (don’t claim 0)
        if (Number.isFinite(vid)) {
          const iq = (v && typeof v.inventory_quantity !== "undefined")
            ? Number(v.inventory_quantity)
            : null;
          variantFallbackQty[vid] = Number.isFinite(iq as any) ? (iq as number) : null;
        }
      }

      // anything in the slice we did not see gets retried individually below
      for (const vid of slice) if (!seen.has(vid)) idsMissed.push(vid);
    }

    // retry any missed as individual GETs (Shopify occasionally drops a row in big ids queries)
    if (idsMissed.length) {
      for (const vid of idsMissed) {
        const res = await shopifyRest(`/variants/${vid}.json?fields=id,inventory_item_id,inventory_quantity`, { method: "GET" });
        if (!res.ok) continue;
        const j = await res.json().catch(() => ({}));
        const v = j?.variant;
        const itemId = Number(v?.inventory_item_id);
        if (Number.isFinite(itemId)) variantToItem[vid] = itemId;
        const iq = (v && typeof v.inventory_quantity !== "undefined") ? Number(v.inventory_quantity) : null;
        variantFallbackQty[vid] = Number.isFinite(iq as any) ? (iq as number) : null;
      }
    }

    const itemIds = Object.values(variantToItem);
    diagnostics.resolvedVariantIds = Object.keys(variantToItem).length;
    diagnostics.mappedItems = itemIds.length;

    // 2) Preferred: sum inventory_levels across locations (requires read_inventory)
    const totalsByItem: Record<number, number> = {};
    let levelsWorked = false;
    let levelsForbidden = false;

    if (itemIds.length) {
      for (let i = 0; i < itemIds.length; i += size) {
        const slice = itemIds.slice(i, i + size);
        const res = await shopifyRest(`/inventory_levels.json?inventory_item_ids=${slice.join(",")}`, { method: "GET" });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            levelsForbidden = true;
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
    }

    // 3) Build output: number (0+) when known, null when unknown
    const out: Record<string, number | null> = {};
    for (const vid of variantIds) {
      const iid = variantToItem[vid];

      if (levelsWorked && Number.isFinite(iid)) {
        // If the item had no level rows at all, that means 0 at all locations.
        out[String(vid)] = totalsByItem[iid] ?? 0;
        continue;
      }

      // Fallback to old field if present; otherwise “unknown” (null) instead of pretending 0
      if (Object.prototype.hasOwnProperty.call(variantFallbackQty, vid)) {
        out[String(vid)] = variantFallbackQty[vid]; // may be number or null
      } else {
        out[String(vid)] = null;
      }
    }

    return NextResponse.json(
      {
        stock: out,
        _source: levelsWorked ? "inventory_levels" : "variants.inventory_quantity (fallback)",
        _diagnostics: { ...diagnostics, levelsWorked, levelsForbidden }
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
