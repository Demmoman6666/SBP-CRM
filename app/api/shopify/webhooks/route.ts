// app/api/shopify/webhooks/route.ts
import { NextResponse } from "next/server";
import {
  verifyShopifyHmac,
  upsertCustomerFromShopify,
  upsertOrderFromShopify,
} from "@/lib/shopify";

export const runtime = "nodejs";        // Node runtime so we can read raw body
export const dynamic = "force-dynamic"; // never cache

const EXPECTED_SHOP = (process.env.SHOPIFY_SHOP_DOMAIN || "").toLowerCase();

function ok(text = "ok", code = 200) {
  return new NextResponse(text, { status: code });
}
function bad(msg: string, code = 400) {
  console.error(msg);
  return new NextResponse(msg, { status: code });
}

// Optional: answer to GET so you can visit the route and see "ok"
export async function GET() {
  return ok();
}

export async function POST(req: Request) {
  const topic = (req.headers.get("x-shopify-topic") || "").toLowerCase();
  const shop  = (req.headers.get("x-shopify-shop-domain") || "").toLowerCase();
  const hmac  = req.headers.get("x-shopify-hmac-sha256");

  // 1) Read RAW body first
  const raw = await req.arrayBuffer();

  // 2) Verify HMAC signature using your API secret key (SHOPIFY_WEBHOOK_SECRET)
  const valid = verifyShopifyHmac(raw, hmac);
  if (!valid) {
    return bad(`Shopify webhook HMAC failed { topic: '${topic}', shopDomain: '${shop}' }`, 401);
  }

  // (Optional) also ensure the webhook came from the shop you expect
  if (EXPECTED_SHOP && shop && shop !== EXPECTED_SHOP) {
    return bad(`Unexpected shop domain '${shop}' (expected '${EXPECTED_SHOP}')`, 401);
  }

  // 3) Parse JSON only after verifying HMAC
  let body: any;
  try {
    body = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch (e: any) {
    return bad(`Invalid JSON: ${e?.message || String(e)}`, 400);
  }

  try {
    if (topic === "customers/create" || topic === "customers/update") {
      const customer = body?.customer ?? body;
      await upsertCustomerFromShopify(customer, shop);
      console.log(`[WEBHOOK] customer upserted from ${topic} id=${customer?.id ?? "?"}`);
      return ok();
    }

    if (topic === "orders/create" || topic === "orders/updated") {
      const order = body?.order ?? body;
      await upsertOrderFromShopify(order, shop);
      console.log(`[WEBHOOK] order upserted from ${topic} id=${order?.id ?? "?"}`);
      return ok();
    }

    // Unknown topic — still return 200 so Shopify doesn't retry forever
    console.log(`[WEBHOOK] ignored topic '${topic}' from ${shop}`);
    return ok();
  } catch (err: any) {
    console.error(`[WEBHOOK] handler error for ${topic}:`, err?.stack || err?.message || err);
    return bad("Handler failed", 500);
  }
}
