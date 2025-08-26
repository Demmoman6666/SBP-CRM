// app/api/shopify/backfill/customers/route.ts
import { NextResponse } from "next/server";
import { shopifyRest, upsertCustomerFromShopify } from "@/lib/shopify";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.SYNC_ADMIN_TOKEN}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const pageInfo = url.searchParams.get("page_info");

  const query = pageInfo ? `?limit=250&page_info=${encodeURIComponent(pageInfo)}` : "?limit=250";
  const res = await shopifyRest(`/customers.json${query}`, { method: "GET" });
  const json = await res.json();

  for (const c of json.customers || []) {
    await upsertCustomerFromShopify(c, process.env.SHOPIFY_SHOP_DOMAIN!);
  }

  // Relay pagination cursor (Link header)
  const link = res.headers.get("link") || "";
  // e.g. <https://.../customers.json?limit=250&page_info=XYZ>; rel="next"
  const match = link.match(/<[^>]*page_info=([^>]+)>;\s*rel="next"/i);
  const nextPageInfo = match ? match[1] : null;

  return NextResponse.json({ imported: (json.customers || []).length, nextPageInfo });
}
