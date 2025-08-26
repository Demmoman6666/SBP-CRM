// app/api/shopify/webhooks/route.ts
import { NextResponse } from "next/server";
import { verifyShopifyHmac, upsertCustomerFromShopify, upsertOrderFromShopify } from "@/lib/shopify";

export const runtime = "nodejs";         // ensure Node runtime (not edge)
export const dynamic = "force-dynamic";  // never cache

function ok() { return new NextResponse("ok", { status: 200 }); }
function bad(msg: string, code = 400) {
  console.error(msg);
  return new NextResponse(msg, { status: code });
}

export async function POST(req: Request) {
  const topic = req.headers.get("x-shopify-topic") || "";
  const shop  = req.headers.get("x-shopify-shop-domain") || "";
  const hmac  = req.headers.get("x-shopify-hmac-sha256");

  // 1) Read RAW body first
  const raw = await req.arrayBuffer();

  // 2) Verify HMAC against the RAW bytes
  const valid = verifyShopifyHmac(raw, hmac);
  if (!valid) {
    return bad(`Shopify webhook HMAC failed { topic: '${topic}', shopDomain: '${shop}' }`, 401);
  }

  // 3) Parse after verification
  let body: any;
  try {
    body = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch (e: any) {
    return bad(`Invalid JSON: ${e?.message || e}`, 400);
  }

  try {
    if (topic === "customers/create" || topic === "customers/update") {
      const customer = body?.customer || body;
      await upsertCustomerFromShopify(customer, shop);
      console.log(`[WEBHOOK] customer upserted from ${topic} ${customer?.id ?? ""}`);
      return ok();
    }

    if (topic === "orders/create" || topic === "orders/updated") {
      const order = body?.order || body;
      await upsertOrderFromShopify(order, shop);
      console.log(`[WEBHOOK] order upserted from ${topic} ${order?.id ?? ""}`);
      return ok();
    }

    // unknown topic – still 200 so Shopify doesn’t retry forever
    console.log(`[WEBHOOK] ignored topic '${topic}' from ${shop}`);
    return ok();
  } catch (err: any) {
    console.error(`[WEBHOOK] handler error for ${topic}:`, err?.message || err);
    return bad("Handler failed", 500);
  }
}

// Optional: a simple GET so you can quickly test the route is deployed
export async function GET() {
  return ok();
}
