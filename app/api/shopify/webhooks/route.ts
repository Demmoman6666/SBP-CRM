// app/api/shopify/webhooks/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyShopifyHmac,
  upsertCustomerFromShopify,
  upsertOrderFromShopify,
} from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED_SHOP = (process.env.SHOPIFY_SHOP_DOMAIN || "").toLowerCase();

function ok(text = "ok", code = 200) { return new NextResponse(text, { status: code }); }
function bad(msg: string, code = 400) { console.error(msg); return new NextResponse(msg, { status: code }); }

// --- helper: extract vendor from product payload and upsert into StockedBrand
async function upsertStockedBrandFromProductPayload(payload: any) {
  const product = payload?.product ?? payload;
  const vendor = (product?.vendor || "").toString().trim();
  if (!vendor) return null;

  await prisma.stockedBrand.upsert({
    where: { name: vendor },
    update: {},
    create: { name: vendor },
  });
  return vendor;
}

export async function GET() { return ok(); }

export async function POST(req: Request) {
  const topic = (req.headers.get("x-shopify-topic") || "").toLowerCase();
  const shop  = (req.headers.get("x-shopify-shop-domain") || "").toLowerCase();
  const hmac  = req.headers.get("x-shopify-hmac-sha256");

  // 1) raw body
  const raw = await req.arrayBuffer();

  // 2) HMAC verify
  const valid = verifyShopifyHmac(raw, hmac);
  if (!valid) {
    return bad(`Shopify webhook HMAC failed { topic: '${topic}', shopDomain: '${shop}' }`, 401);
  }

  if (EXPECTED_SHOP && shop && shop !== EXPECTED_SHOP) {
    return bad(`Unexpected shop domain '${shop}' (expected '${EXPECTED_SHOP}')`, 401);
  }

  // 3) parse
  let body: any;
  try {
    body = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch (e: any) {
    return bad(`Invalid JSON: ${e?.message || String(e)}`, 400);
  }

  try {
    // ───────── products → keep StockedBrand in sync ─────────
    if (topic === "products/create" || topic === "products/update") {
      const vendor = await upsertStockedBrandFromProductPayload(body);
      if (vendor) {
        console.log(`[WEBHOOK] stocked brand upserted from ${topic}: "${vendor}"`);
      } else {
        console.log(`[WEBHOOK] ${topic} had no vendor, nothing to upsert`);
      }
      return ok();
    }

    // ───────── customers (create/update + tag-only topics) ─────────
    if (
      topic === "customers/create" ||
      topic === "customers/update" ||
      topic === "customer.tags_added" ||
      topic === "customer.tags_removed" ||
      topic === "customers/tags/add" ||
      topic === "customers/tags/remove"
    ) {
      const customer = body?.customer ?? body;
      await upsertCustomerFromShopify(customer, shop);
      console.log(
        `[WEBHOOK] customer upserted from ${topic} id=${customer?.id ?? "?"} tags=${JSON.stringify(customer?.tags)}`
      );
      return ok();
    }

    // ───────── orders ─────────
    if (topic === "orders/create" || topic === "orders/updated") {
      const order = body?.order ?? body;
      await upsertOrderFromShopify(order, shop);
      console.log(`[WEBHOOK] order upserted from ${topic} id=${order?.id ?? "?"}`);
      return ok();
    }

    // Unknown/ignored topics still 200 so Shopify doesn't retry forever
    console.log(`[WEBHOOK] ignored topic '${topic}' from ${shop}`);
    return ok();
  } catch (err: any) {
    console.error(`[WEBHOOK] handler error for ${topic}:`, err?.stack || err?.message || err);
    return bad("Handler failed", 500);
  }
}
