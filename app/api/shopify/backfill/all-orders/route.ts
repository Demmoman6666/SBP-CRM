// app/api/shopify/backfill/all-orders/route.ts
import { NextResponse } from "next/server";
import { shopifyRest, upsertCustomerFromShopify, upsertOrderFromShopify } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(msg: string, code = 400) {
  console.error("[backfill-all-orders] " + msg);
  return new NextResponse(msg, { status: code });
}

/** Extract page_info from Shopify Link header (if present) */
function getNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // Examples:
  // <https://shop.myshopify.com/admin/api/2024-07/orders.json?limit=250&page_info=xyz>; rel="next"
  const parts = linkHeader.split(",").map(s => s.trim());
  for (const p of parts) {
    if (!/rel="next"/.test(p)) continue;
    const m = p.match(/<([^>]+)>/);
    if (!m) continue;
    try {
      const url = new URL(m[1]);
      const pi = url.searchParams.get("page_info");
      if (pi) return pi;
    } catch {/* ignore */}
  }
  return null;
}

/**
 * POST /api/shopify/backfill/all-orders
 * Query params (optional):
 *   - limit (1..250, default 250)
 *   - pageInfo (cursor from previous call)
 *   - created_at_min (ISO8601)
 *   - created_at_max (ISO8601)
 *
 * Behavior:
 *   - First page: fetch with status=any, order=created_at asc (oldest first), limit, and optional date filters
 *   - Next pages: fetch with page_info + limit only (Shopify cursor rules)
 * Returns:
 *   { imported: number, nextPageInfo: string|null }
 */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitRaw = Number(searchParams.get("limit") || 250);
  const limit = Math.min(Math.max(limitRaw, 1), 250);

  const pageInfo = searchParams.get("pageInfo") || null;
  const createdMin = searchParams.get("created_at_min") || null;
  const createdMax = searchParams.get("created_at_max") || null;

  let url: string;

  if (pageInfo) {
    // FOLLOW-UP PAGE (cursor mode): only include page_info + limit
    const qp = new URLSearchParams();
    qp.set("limit", String(limit));
    qp.set("page_info", pageInfo);
    url = `/orders.json?${qp.toString()}`;
  } else {
    // FIRST PAGE: include filters and direction
    const qp = new URLSearchParams();
    qp.set("status", "any");
    qp.set("order", "created_at asc"); // oldest → newest to ensure we eventually catch everything
    qp.set("limit", String(limit));
    if (createdMin) qp.set("created_at_min", createdMin);
    if (createdMax) qp.set("created_at_max", createdMax);
    url = `/orders.json?${qp.toString()}`;
  }

  const res = await shopifyRest(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return bad(`Shopify GET ${url} failed: ${res.status} ${text}`, 502);
  }

  // Parse next cursor from Link header
  const linkHeader = res.headers.get("link");
  const nextPageInfo = getNextPageInfo(linkHeader);

  const json = await res.json();
  const orders: any[] = Array.isArray(json?.orders) ? json.orders : [];

  let imported = 0;

  // Upsert each order (customer first to ensure order can link)
  for (const ord of orders) {
    try {
      if (ord.customer) {
        await upsertCustomerFromShopify(ord.customer, ord?.shop_domain || "");
      }
      await upsertOrderFromShopify(ord, ord?.shop_domain || "");
      imported++;
    } catch (e: any) {
      console.error("[backfill-all-orders] upsert failed:", e?.message || e);
    }
  }

  return NextResponse.json({ imported, nextPageInfo });
}
