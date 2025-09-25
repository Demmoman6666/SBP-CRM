import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireShopifyEnv, shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = { skus: string[]; days: number; locationId?: string | null };

function utcMidnight(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
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
function dayIndex(iso: string, startUtc: Date, windowDays: number) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  const idx = Math.floor((t - startUtc.getTime()) / (24 * 60 * 60 * 1000));
  return idx >= 0 && idx < windowDays ? idx : null;
}

export async function POST(req: NextRequest) {
  try {
    requireShopifyEnv();

    const { skus, days, locationId }: Body = await req.json();
    const skuSet = new Set((skus || []).map(s => String(s).trim()).filter(Boolean));
    const windowDays = Math.max(1, Math.min(Number(days || 60), 365));
    if (!skuSet.size) return NextResponse.json({ ok: true, days: {}, source: "none" });

    const now = new Date();
    const start = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const startUtc = utcMidnight(start);
    const endUtc = utcMidnight(now);

    // 1) Try exact: use snapshots if we have enough coverage
    const snapRows = await prisma.inventoryDay.findMany({
      where: {
        sku: { in: Array.from(skuSet) },
        locationId: null, // change to locationId if you snapshot per-location
        date: { gte: startUtc, lt: endUtc },
      },
      select: { sku: true, date: true, available: true },
    });

    const bySkuDate = new Map<string, Map<number, number>>();
    for (const r of snapRows) {
      const sku = r.sku;
      const dIdx = Math.floor((utcMidnight(r.date).getTime() - startUtc.getTime()) / (24 * 60 * 60 * 1000));
      if (dIdx < 0 || dIdx >= windowDays) continue;
      if (!bySkuDate.has(sku)) bySkuDate.set(sku, new Map());
      bySkuDate.get(sku)!.set(dIdx, r.available);
    }

    const oosFromSnapshots: Record<string, number> = {};
    let haveSnapshots = false;

    for (const sku of skuSet) {
      const dayMap = bySkuDate.get(sku);
      if (!dayMap) continue;
      // Require at least 70% coverage to trust snapshots
      if (dayMap.size >= Math.ceil(windowDays * 0.7)) {
        haveSnapshots = true;
        let oos = 0;
        for (let d = 0; d < windowDays; d++) {
          const avail = dayMap.get(d);
          if (avail != null && avail <= 0) oos++;
        }
        oosFromSnapshots[sku] = oos;
      }
    }

    if (haveSnapshots) {
      return NextResponse.json({ ok: true, days: oosFromSnapshots, source: "snapshots" });
    }

    // 2) Fallback: inferred from orders + fulfillments (proxy)
    const ordered: Record<string, number[]> = {};
    const shipped: Record<string, number[]> = {};
    for (const sku of skuSet) {
      ordered[sku] = new Array(windowDays).fill(0);
      shipped[sku] = new Array(windowDays).fill(0);
    }

    let pageInfo: string | null = null;
    let guard = 0;
    do {
      const qs = new URLSearchParams({
        status: "any", // paid + unpaid; drafts excluded by /orders.json
        created_at_min: start.toISOString(),
        limit: "250",
      });
      if (pageInfo) qs.set("page_info", pageInfo);

      const res = await shopifyRest(`/orders.json?${qs.toString()}`, { method: "GET" });
      if (!res.ok) throw new Error(`Shopify orders failed: ${res.status}`);
      const json = await res.json();

      const orders: any[] = json?.orders || [];
      for (const order of orders) {
        if (order.cancelled_at) continue;

        const createdIdx = dayIndex(order.created_at, startUtc, windowDays);
        if (createdIdx != null && Array.isArray(order.line_items)) {
          for (const li of order.line_items) {
            const sku = String(li?.sku || "").trim();
            if (!skuSet.has(sku)) continue;
            const qty = Number(li?.quantity ?? 0) || 0;
            if (qty > 0) ordered[sku][createdIdx] += qty;
          }
        }

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

    const oosProxy: Record<string, number> = {};
    for (const sku of skuSet) {
      let open = 0;
      let oos = 0;
      for (let d = 0; d < windowDays; d++) {
        open += (ordered[sku][d] || 0) - (shipped[sku][d] || 0);
        const shippedToday = shipped[sku][d] || 0;
        if (open > 0 && shippedToday === 0) oos++;
      }
      oosProxy[sku] = oos;
    }

    return NextResponse.json({ ok: true, days: oosProxy, source: "orders+fulfillments" });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
