// app/api/shopify/webhooks/route.ts
import { NextResponse } from "next/server";
import { verifyShopifyHmac, upsertCustomerFromShopify, upsertOrderFromShopify } from "@/lib/shopify";

export async function POST(req: Request) {
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const shop = req.headers.get("x-shopify-shop-domain") ?? "";
  const hmac = req.headers.get("x-shopify-hmac-sha256");

  const buf = Buffer.from(await req.arrayBuffer());
  if (!verifyShopifyHmac(buf, hmac)) {
    return new NextResponse("Bad HMAC", { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(buf.toString("utf8")); }
  catch { return new NextResponse("Bad JSON", { status: 400 }); }

  try {
    if (topic.startsWith("customers/")) {
      await upsertCustomerFromShopify(payload, shop);
    } else if (topic.startsWith("orders/")) {
      await upsertOrderFromShopify(payload, shop);
    } else if (topic === "app/uninstalled") {
      // Optional: cleanup, disable sync flags, etc.
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Webhook error", topic, e?.message);
    return new NextResponse("Error", { status: 500 });
  }
}
