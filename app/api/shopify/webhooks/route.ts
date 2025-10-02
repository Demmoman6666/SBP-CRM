// app/api/shopify/webhooks/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyShopifyHmac,
  upsertCustomerFromShopifyById,
  upsertOrderFromShopify,
  parseShopifyTags,
  extractShopifyCustomerId,
  shopifyGraphql,
} from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED_SHOP = (process.env.SHOPIFY_SHOP_DOMAIN || "").toLowerCase();

function ok(text = "ok", code = 200) {
  return new NextResponse(text, { status: code });
}
function bad(msg: string, code = 400) {
  console.error(msg);
  return new NextResponse(msg, { status: code });
}

export async function GET() {
  return ok();
}

export async function POST(req: Request) {
  const topic = (req.headers.get("x-shopify-topic") || "").toLowerCase();
  const shop = (req.headers.get("x-shopify-shop-domain") || "").toLowerCase();
  const hmac = req.headers.get("x-shopify-hmac-sha256");

  const raw = await req.arrayBuffer();
  if (!verifyShopifyHmac(raw, hmac)) {
    return bad(
      `Shopify webhook HMAC failed { topic: '${topic}', shopDomain: '${shop}' }`,
      401
    );
  }
  if (EXPECTED_SHOP && shop && shop !== EXPECTED_SHOP) {
    return bad(`Unexpected shop domain '${shop}' (expected '${EXPECTED_SHOP}')`, 401);
  }

  let body: any;
  try {
    body = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch (e: any) {
    return bad(`Invalid JSON: ${e?.message || String(e)}`, 400);
  }

  try {
    // ───────── inventory_items/update → cache unit cost per variant ─────────
    if (topic === "inventory_items/update") {
      const invId =
        String(body?.inventory_item?.id ?? body?.id ?? body?.inventory_item_id ?? "") || "";
      if (!invId) {
        console.warn("[WEBHOOK] inventory_items/update missing inventory_item.id");
        return ok();
      }

      const q = `
        query InvItem($id: ID!) {
          inventoryItem(id: $id) {
            unitCost { amount currencyCode }
            variant { legacyResourceId }
          }
        }`;
      type Gx = {
        inventoryItem: {
          unitCost?: { amount: string; currencyCode: string } | null;
          variant?: { legacyResourceId?: string | null } | null;
        } | null;
      };

      try {
        const data = await shopifyGraphql<Gx>(q, {
          id: `gid://shopify/InventoryItem/${invId}`,
        });

        const legacyVariantId = data?.inventoryItem?.variant?.legacyResourceId;
        const amountStr = data?.inventoryItem?.unitCost?.amount ?? null;
        const currency = data?.inventoryItem?.unitCost?.currencyCode ?? "GBP";

        if (!legacyVariantId || amountStr == null) {
          console.info(
            "[WEBHOOK] inventory_items/update: no variant/cost to upsert",
            { invId, legacyVariantId, amountStr }
          );
          return ok();
        }

        const unitCost = Number(amountStr);

        await prisma.shopifyVariantCost.upsert({
          where: { variantId: String(legacyVariantId) },
          create: {
            variantId: String(legacyVariantId),
            unitCost,
            currency,
          },
          update: {
            unitCost,
            currency,
          },
        });

        console.log(
          `[WEBHOOK] cost cached for variant ${legacyVariantId} @ ${unitCost} ${currency}`
        );
      } catch (e) {
        console.error("[WEBHOOK] inventory_items/update GraphQL/upsert error:", e);
      }
      return ok();
    }

    // ───────── customers (CREATE / UPDATE) ─────────
    if (topic === "customers/create" || topic === "customers/update") {
      const payload = body?.customer ?? body;
      const shopifyId = extractShopifyCustomerId(payload);

      console.info(`[WEBHOOK] ${topic} id=${shopifyId ?? "?"}`);

      await upsertCustomerFromShopifyById(String(shopifyId), shop, {
        updateOnly: false,
        matchBy: "shopifyIdOrEmail",
      });
      return ok();
    }

    // ───────── tag delta webhooks: UPDATE EXISTING ONLY ─────────
    if (topic === "customer.tags_added" || topic === "customer.tags_removed") {
      const shopifyId =
        extractShopifyCustomerId(body) ?? extractShopifyCustomerId(body?.customer);
      const eventTags = parseShopifyTags(
        body?.tags ?? body?.added_tags ?? body?.removed_tags
      );

      console.info(
        `[WEBHOOK] ${topic} id=${shopifyId ?? "?"} eventTags=${JSON.stringify(eventTags)}`
      );

      if (!shopifyId) {
        console.warn(`[WEBHOOK] ${topic} missing customer id; skipping`);
        return ok();
      }

      await upsertCustomerFromShopifyById(String(shopifyId), shop, {
        updateOnly: true,
        matchBy: "shopifyIdOnly",
      });
      return ok();
    }

    // ───────── orders ─────────
    if (
      topic === "orders/create" ||
      topic === "orders/updated" ||
      topic === "orders/paid" ||
      topic === "orders/fulfilled" ||
      topic === "orders/partially_fulfilled"
    ) {
      const order = body?.order ?? body;
      await upsertOrderFromShopify(order, shop);
      console.log(`[WEBHOOK] order upserted from ${topic} id=${order?.id ?? "?"}`);
      return ok();
    }

    // Ignore everything else, but 200 so Shopify doesn’t retry
    console.log(`[WEBHOOK] ignored topic '${topic}' from ${shop}`);
    return ok();
  } catch (err: any) {
    console.error(`[WEBHOOK] handler error for ${topic}:`, err?.stack || err?.message || err);
    return bad("Handler failed", 500);
  }
}
