import { NextRequest, NextResponse } from "next/server";
import { requireShopifyEnv, shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Input = {
  skus: string[];
  locationId?: string | null; // Shopify location id
  days30?: boolean;           // default true
  days60?: boolean;           // default true
};

function isoRange(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function nextPageInfo(linkHeader?: string | null) {
  if (!linkHeader) return null;
  const part = linkHeader.split(",").map(s => s.trim()).find(s => /rel="next"/i.test(s));
  if (!part) return null;
  const m = part.match(/<([^>]+)>/);
  if (!m) return null;
  const url = new URL(m[1]);
  return url.searchParams.get("page_info");
}

export async function POST(req: NextRequest) {
  try {
    requireShopifyEnv();
    const body = (await req.json().catch(() => ({}))) as Input;
    const skus = Array.from(new Set(body.skus || [])).filter(Boolean).slice(0, 800);
    if (!skus.length) return NextResponse.json({ ok: false, error: "No SKUs provided" }, { status: 400 });

    const want30 = body.days30 !== false;
    const want60 = body.days60 !== false;
    const locationId = body.locationId || undefined;

    const result: Record<string, { d30?: number; d60?: number }> = {};
    for (const s of skus) result[s] = { d30: want30 ? 0 : undefined, d60: want60 ? 0 : undefined };

    async function countWindow(days: number): Promise<Record<string, number>> {
      const { from, to } = isoRange(days);
      const perSku: Record<string, number> = {};
      for (const s of skus) perSku[s] = 0;

      let pageInfo: string | null = null;
      let guard = 0;

      do {
        // We fetch orders with fulfillments + line_items to map fulfillment lines back to SKUs
        const qs = new URLSearchParams({
          status: "any",
          processed_at_min: from,
          processed_at_max: to,
          limit: "250",
          fields: "id,processed_at,fulfillments,line_items",
        });
        if (pageInfo) qs.set("page_info", pageInfo);

        const res = await shopifyRest(`/orders.json?${qs.toString()}`, { method: "GET" });
        if (!res.ok) throw new Error(`Shopify orders failed: ${res.status}`);
        const data = await res.json();
        const orders = data?.orders || [];

        for (const ord of orders) {
          // Map order line_item id -> sku
          const liMap = new Map<number, string>();
          (ord.line_items || []).forEach((li: any) => {
            const sku = String(li?.sku || "").trim();
            if (sku) liMap.set(Number(li.id), sku);
          });

          for (const f of ord.fulfillments || []) {
            if (locationId && String(f.location_id) !== String(locationId)) continue;
            for (const fli of f.line_items || []) {
              const liId = Number(fli?.id ?? fli?.line_item_id);
              const qty = Number(fli?.quantity || 0) || 0;
              const sku = liMap.get(liId);
              if (!sku) continue;
              if (!(sku in perSku)) continue; // only tally SKUs we asked for
              perSku[sku] += qty;
            }
          }
        }

        pageInfo = nextPageInfo(res.headers.get("link"));
        guard++;
      } while (pageInfo && guard < 40);

      return perSku;
    }

    if (want60) {
      const sums60 = await countWindow(60);
      for (const [sku, qty] of Object.entries(sums60)) result[sku].d60 = qty;
    }
    if (want30) {
      const sums30 = await countWindow(30);
      for (const [sku, qty] of Object.entries(sums30)) result[sku].d30 = qty;
    }

    return NextResponse.json({ ok: true, source: "ShopifyFulfillments", sales: result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
