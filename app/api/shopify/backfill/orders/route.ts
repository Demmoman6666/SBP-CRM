// app/api/shopify/backfill/orders/route.ts
import { NextResponse } from "next/server";
import { shopifyRest, upsertOrderFromShopify } from "@/lib/shopify";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.SYNC_ADMIN_TOKEN}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const pageInfo = url.searchParams.get("page_info");

  // status=any to include closed/open/cancelled; order oldest→newest to be deterministic
  const query = pageInfo
    ? `?limit=250&status=any&order=created_at+asc&page_info=${encodeURIComponent(pageInfo)}`
    : `?limit=250&status=any&order=created_at+asc`;

  const res = await shopifyRest(`/orders.json${query}`, { method: "GET" });
  const json = await res.json();

  for (const o of json.orders || []) {
    await upsertOrderFromShopify(o, process.env.SHOPIFY_SHOP_DOMAIN!);
  }

  const link = res.headers.get("link") || "";
  const match = link.match(/<[^>]*page_info=([^>]+)>;\s*rel="next"/i);
  const nextPageInfo = match ? match[1] : null;

  return NextResponse.json({ imported: (json.orders || []).length, nextPageInfo });
}
