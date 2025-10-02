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
  fetchVariantUnitCosts,
  gidToNumericId,
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

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

    // ───────── products/update → refresh costs for all variants on the product ─────────
    if (topic === "products/update") {
      const variants = Array.isArray(body?.variants)
        ? body.variants
        : Array.isArray(body?.product?.variants)
        ? body.product.variants
        : [];

      const variantIds = (variants as any[])
        .map((v) => {
          if (v?.id != null && typeof v.id !== "object") return `${v.id}`;
          if (v?.admin_graphql_api_id) {
            const n = gidToNumericId(String(v.admin_graphql_api_id));
            if (n) return n;
          }
          return null;
        })
        .filter(Boolean) as string[];

      if (!variantIds.length) {
        console.log("[WEBHOOK] products/update: no variants in payload");
        return ok();
      }

      try {
        const rawMap: any = await fetchVariantUnitCosts(variantIds);
        const pairs: [string, { unitCost: number; currency: string }][] =
          rawMap && typeof rawMap === "object" && typeof rawMap.entries === "function"
            ? Array.from(rawMap.entries())
            : (Object.entries(rawMap || {}) as [string, { unitCost: number; currency: string }][]);

        let upserts = 0;
        for (const [variantId, entry] of pairs) {
          await prisma.shopifyVariantCost.upsert({
            where: { variantId: `${variantId}` },
            create: { variantId: `${variantId}`, unitCost: entry.unitCost, currency: entry.currency },
            update: { unitCost: entry.unitCost, currency: entry.currency },
          });
          upserts++;
        }

        console.log(`[WEBHOOK] products/update: cached ${upserts} variant costs`);
      } catch (e) {
        console.error("[WEBHOOK] products/update cost-refresh error:", e);
      }
      return ok();
    }

    // ───────── refunds/create → apply full/partial refunds ─────────
    if (topic === "refunds/create") {
      // Idempotency guard
      const refundId = String(body?.id ?? body?.refund?.id ?? "");
      if (refundId) {
        const seen = await prisma.webhookLog.findFirst({
          where: { topic: "refunds/create", shopifyId: refundId },
          select: { id: true },
        });
        if (seen) {
          console.log(`[WEBHOOK] refunds/create ${refundId} already processed`);
          return ok("duplicate");
        }
      }

      // Shape-normalize
      const refund = body?.refund ?? body;
      const orderIdStr = String(
        refund?.order_id ?? body?.order_id ?? refund?.order?.id ?? ""
      );

      if (!orderIdStr) {
        console.warn("[WEBHOOK] refunds/create missing order_id");
        // Still log the payload so we can inspect later
        if (refundId) {
          await prisma.webhookLog.create({
            data: { topic: "refunds/create", shopifyId: refundId, payload: body },
          });
        }
        return ok();
      }

      let refundedNet = 0;       // ex VAT (after discounts)
      let refundedTax = 0;
      let refundedShipping = 0;

      // Line-level refunds
      const refundLineItems: any[] = Array.isArray(refund?.refund_line_items)
        ? refund.refund_line_items
        : [];

      for (const rli of refundLineItems) {
        // Shopify commonly provides subtotal (ex tax) and total_tax on the refund_line_item
        const sub =
          toNum(rli?.subtotal) ||
          toNum(rli?.subtotal_set?.shop_money?.amount) ||
          toNum(rli?.subtotal_set?.presentment_money?.amount);
        const tax =
          toNum(rli?.total_tax) ||
          toNum(rli?.total_tax_set?.shop_money?.amount) ||
          toNum(rli?.total_tax_set?.presentment_money?.amount);

        refundedNet += sub;
        refundedTax += tax;

        const qty = Number(rli?.quantity ?? 0) || 0;
        const liId = String(rli?.line_item_id ?? rli?.line_item?.id ?? "") || "";

        // Increment refundedQuantity on our line item (if we have it cached)
        if (liId) {
          try {
            await prisma.orderLineItem.update({
              where: { shopifyLineItemId: liId },
              data: { refundedQuantity: { increment: qty } },
            });
          } catch {
            // If we don't have this line item cached yet, ignore.
          }
        }
      }

      // Shipping refund (if present in payload)
      const shippingRefund = refund?.shipping || refund?.refund_shipping;
      if (shippingRefund) {
        refundedShipping += toNum(shippingRefund.amount);
        refundedTax += toNum(shippingRefund.tax);
      }

      // Order-level adjustments (treat "shipping" kinds as shipping, everything else as net/tax)
      const adjustments: any[] = Array.isArray(refund?.order_adjustments)
        ? refund.order_adjustments
        : [];
      for (const adj of adjustments) {
        const amount = toNum(adj?.amount);
        const taxAmount = toNum(adj?.tax_amount);
        const kind = String(adj?.kind || "").toLowerCase();
        if (kind.includes("shipping")) {
          refundedShipping += amount;
          refundedTax += taxAmount;
        } else {
          refundedNet += amount;
          refundedTax += taxAmount;
        }
      }

      const refundedTotal = refundedNet + refundedTax + refundedShipping;

      // Persist order-level refund aggregates (upsert to be safe if order wasn’t cached yet)
      await prisma.order.upsert({
        where: { shopifyOrderId: orderIdStr },
        create: {
          shopifyOrderId: orderIdStr,
          refundedNet,
          refundedTax,
          refundedShipping,
          refundedTotal,
        },
        update: {
          refundedNet: { increment: refundedNet },
          refundedTax: { increment: refundedTax },
          refundedShipping: { increment: refundedShipping },
          refundedTotal: { increment: refundedTotal },
        },
      });

      // Log once for idempotency checking
      if (refundId) {
        await prisma.webhookLog.create({
          data: { topic: "refunds/create", shopifyId: refundId, payload: body },
        });
      }

      console.log(
        `[WEBHOOK] refunds/create order=${orderIdStr} net=${refundedNet.toFixed(
          2
        )} tax=${refundedTax.toFixed(2)} ship=${refundedShipping.toFixed(2)} total=${refundedTotal.toFixed(2)}`
      );

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
