// app/api/shopify/webhooks/route.ts
import { NextResponse } from "next/server";
import { verifyShopifyHmac, upsertCustomerFromShopify, upsertOrderFromShopify } from "@/lib/shopify";
import { prisma } from "@/lib/prisma"; // optional: for logging

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const shopDomain = req.headers.get("x-shopify-shop-domain") ?? "";
  const hmac = req.headers.get("x-shopify-hmac-sha256");

  // Raw body for HMAC verification
  const buf = await req.arrayBuffer();

  // Verify HMAC
  if (!verifyShopifyHmac(buf, hmac)) {
    console.error("❌ Shopify webhook HMAC failed", { topic, shopDomain });
    return new NextResponse("Invalid HMAC", { status: 401 });
  }

  // Parse JSON once (do NOT call req.json() after reading the buffer)
  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(buf));
  } catch (e) {
    console.error("❌ Bad JSON in webhook", e);
    return new NextResponse("Bad JSON", { status: 400 });
  }

  try {
    // Optional: log the webhook for debugging (safe to remove later)
    try {
      await prisma.webhookLog.create({
        data: {
          topic,
          shopifyId: payload?.id ? String(payload.id) : null,
          payload,
        },
      });
    } catch {}

    // Route by topic
    switch (topic) {
      case "customers/create":
      case "customers/update":
        await upsertCustomerFromShopify(payload, shopDomain);
        break;

      case "orders/create":
      case "orders/updated":
        await upsertOrderFromShopify(payload, shopDomain);
        break;

      default:
        // Unknown/unused topic — acknowledge 200 so Shopify stops retrying
        break;
    }

    return new NextResponse("OK", { status: 200 });
  } catch (e) {
    console.error("❌ Webhook handler error", e);
    return new NextResponse("Handler error", { status: 500 });
  }
}
