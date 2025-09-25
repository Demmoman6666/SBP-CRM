import { NextRequest, NextResponse } from "next/server";
import { requireShopifyEnv, shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  skus: string[];
  days: number;                 // look-back window, e.g. 60
  locationId?: string | null;   // optional: filter shipped qty by location
};

// Parse Shopify REST "Link" header for cursor pagination
function nextPageInfo(linkHeader?: string | null) {
  if (!linkHeader) return null;
  const part = linkHeader.split(",").map(s => s.trim()).find(s => /rel="next"/i.test(s));
  if (!part) return null;
  const m = part.match(/<([^>]+)>/);
  if (!m) return null;
  const url = new URL(m[1]);
  return url.searchParams.get("page_info");
}

// Floor to UTC midnight for a JS Date
function utcMidnight(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function POST(req: NextRequest) {
  try {
    requireShopifyEnv();

    const { skus, days, locationId }: Body = await req.json();
    const skuSet = new Set((skus || []).map(s => String(s).trim()).filter(Boolean));
    const windowDays = Math.max(1, Math.min(Number(days || 60), 365));

    if (!skuSet.size) {
      return NextResponse.json({ ok: true, days: {}, source: "orders+fulfillments" });
    }

    // Time window
    const MS_DAY = 24 * 60 * 60 * 1000;
    const now = new Date();
    const start = new Date(now.getTime() - windowDays * MS_DAY);
    const startUtc = utcMidnight(start);

    const ordered: Record<string, number[]> = {};
    const shipped: Record<string, number[]> = {};
    for (const s of skuSet) {
      ordered[s] = new Array(windowDays).fill(0);
      shipped[s] = new Array(windowDays).fill(0);
    }

    // Pull all orders since `start` (status=any; drafts are not returned by /orders)
    let pageInfo: string | null = null;
    let guard = 0;

    do {
      const qs = new URLSearchParams({
        status: "any",                 // paid + unpaid + fulfilled/unfulfilled
        created_at_min: start.toISOString(),
        limit: "250",
      });
      if (pageInfo) qs.set("page_info", pageInfo);

      const res = await shopifyRest(`/orders.json?${qs.toString()}`, { method: "GET" });
      if (!res.ok) throw new Error(`Shopify orders failed: ${res.status}`);
      const json = await res.json();

      const orders: any[] = json?.orders || [];
      for (const order of orders) {
        // Skip cancelled orders
        if (order.cancelled_at) continue;

        // 1) Tally ordered qty for requested SKUs on the order's create day
        const createdIdx = dayIndex(order.created_at, startUtc, windowDays);
        if (createdIdx != null && Array.isArray(order.line_items)) {
          for (const li of order.line_items) {
            const sku = String(li?.sku || "").trim();
            if (!skuSet.has(sku)) continue;
            const qty = Number(li?.quantity ?? 0) || 0;
            if (qty > 0) ordered[sku][createdIdx] += qty;
          }
        }

        // 2) Tally shipped qty from fulfillments (optionally filter by location)
        const fulfils: any[] = order.fulfillments || [];
        for (const f of fulfils) {
          if (locationId && String(f?.location_id || "") !== String(locationId)) continue;
          const fIdx = dayIndex(f?.created_at, startUtc, windowDays);
          if (fIdx == null) continue;

          const fLines: any[] = f?.line_items || [];
          for (const fl of fLines) {
            const sku = String(fl?.sku || "").trim();
            if (!skuSet.has(sku)) continue;
            const qty = Number(fl?.quantity ?? 0) || 0;
            if (qty > 0) shipped[sku][fIdx] += qty;
          }
        }
      }

      pageInfo = nextPageInfo(res.headers.get("link"));
      guard++;
    } while (pageInfo && guard < 40);

    // Walk the window per SKU: backlog and "no-ship" days => OOS days (proxy)
    const oosDays: Record<string, number> = {};
    for (const sku of skuSet) {
      let open = 0; // naive backlog; if there was backlog before the window, this will undercount at the beginning
      let oos = 0;
      for (let d = 0; d < windowDays; d++) {
        open += (ordered[sku][d] || 0) - (shipped[sku][d] || 0);
        const shippedToday = shipped[sku][d] || 0;
        if (open > 0 && shippedToday === 0) oos++;
      }
      oosDays[sku] = oos;
    }

    return NextResponse.json({
      ok: true,
      days: oosDays,
      source: "orders+fulfillments",
      note: "Approximation. For exact daily stockouts, persist daily inventory snapshots."
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}

// Convert a timestamp to a [0..windowDays-1] index relative to startUtc
function dayIndex(iso: string, startUtc: Date, windowDays: number) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  const idx = Math.floor((t - startUtc.getTime()) / (24 * 60 * 60 * 1000));
  return idx >= 0 && idx < windowDays ? idx : null;
}
