// lib/shopify.ts
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN!;
const SHOP_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET!;

/** Call Shopify REST Admin API (bump the version if you prefer) */
export async function shopifyRest(path: string, init: RequestInit = {}) {
  if (!SHOP_DOMAIN || !SHOP_ADMIN_TOKEN) {
    throw new Error("Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN");
  }
  const url = `https://${SHOP_DOMAIN}/admin/api/2024-07${path}`;
  const headers = new Headers(init.headers as any);
  headers.set("X-Shopify-Access-Token", SHOP_ADMIN_TOKEN);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  return fetch(url, { ...init, headers, cache: "no-store" });
}

/** Verify Shopify webhook HMAC */
export function verifyShopifyHmac(
  rawBody: ArrayBuffer | Buffer | string,
  hmacHeader?: string | null
) {
  if (!WEBHOOK_SECRET || !hmacHeader) return false;
  const bodyBuf =
    typeof rawBody === "string" ? Buffer.from(rawBody) : Buffer.from(rawBody as ArrayBuffer);
  const digest = crypto.createHmac("sha256", WEBHOOK_SECRET).update(bodyBuf).digest("base64");
  try {
    const a = Buffer.from(hmacHeader, "utf8");
    const b = Buffer.from(digest, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return digest === hmacHeader;
  }
}

/** Tag → Sales Rep mapping, using your SalesRepTagRule model */
export async function getSalesRepForTags(tags: string[]): Promise<string | null> {
  if (!tags || tags.length === 0) return null;
  const rule = await prisma.salesRepTagRule.findFirst({
    where: { tag: { in: tags } },
    // Your model doesn't have `priority`; use createdAt as a deterministic tie-breaker.
    orderBy: { createdAt: "asc" },
  });
  return rule?.salesRepName ?? null;
}

/** Upsert a CRM Customer from a Shopify customer payload */
export async function upsertCustomerFromShopify(shop: any, shopDomain: string) {
  const shopifyId = String(shop.id);
  const email: string | null = (shop.email || "").toLowerCase() || null;

  const addr = shop.default_address || {};
  const fullName = [shop.first_name, shop.last_name].filter(Boolean).join(" ").trim();
  const company = addr.company || "";
  const phone = shop.phone || addr.phone || null;
  const tags: string[] = shop.tags
    ? String(shop.tags)
        .split(",")
        .map((t: string) => t.trim())
        .filter(Boolean)
    : [];

  const mappedRep = await getSalesRepForTags(tags);

  // Safe fallbacks to satisfy non-null fields in your schema
  const salonName = company || fullName || "Shopify Customer";
  const customerName = fullName || company || "Unknown";

  const base = {
    salonName,
    customerName,
    addressLine1: addr.address1 || "",
    addressLine2: addr.address2 || null,
    town: addr.city || null,
    county: addr.province || null,
    postCode: addr.zip || null,
    customerEmailAddress: email,
    customerTelephone: phone,
    shopifyCustomerId: shopifyId,
    shopifyShopDomain: shopDomain,
  };

  // Prefer match by Shopify ID
  const byShopId = await prisma.customer.findFirst({ where: { shopifyCustomerId: shopifyId } });
  if (byShopId) {
    const updateData: any = { ...base, shopifyTags: { set: tags } };
    if (mappedRep) updateData.salesRep = mappedRep;
    return prisma.customer.update({ where: { id: byShopId.id }, data: updateData });
  }

  // Else try by email (link existing CRM record)
  if (email) {
    const byEmail = await prisma.customer.findFirst({ where: { customerEmailAddress: email } });
    if (byEmail) {
      const updateData: any = { ...base, shopifyTags: { set: tags } };
      if (mappedRep) updateData.salesRep = mappedRep;
      return prisma.customer.update({ where: { id: byEmail.id }, data: updateData });
    }
  }

  // Create new
  const createData: any = { ...base, shopifyTags: tags };
  if (mappedRep) createData.salesRep = mappedRep;
  return prisma.customer.create({ data: createData });
}

/** Upsert Shopify Order + line items (links to Customer via shopifyCustomerId) */
export async function upsertOrderFromShopify(order: any, shopDomain: string) {
  const orderId = String(order.id);
  const custShopId = order.customer ? String(order.customer.id) : null;

  const linkedCustomer =
    custShopId ? await prisma.customer.findFirst({ where: { shopifyCustomerId: custShopId } }) : null;

  // Upsert the order
  const ord = await prisma.shopifyOrder.upsert({
    where: { shopifyOrderId: orderId },
    create: {
      shopifyOrderId: orderId,
      shopDomain,
      createdAtShopify: new Date(order.created_at),
      processedAt: order.processed_at ? new Date(order.processed_at) : null,
      currency: order.currency || null,
      totalPrice: Number(order.total_price || 0),
      subtotalPrice: Number(order.subtotal_price || 0),
      totalTax: Number(order.total_tax || 0),
      totalDiscounts: Number(order.total_discounts || 0),
      financialStatus: order.financial_status || null,
      fulfillmentStatus: order.fulfillment_status || null,
      customerId: linkedCustomer ? linkedCustomer.id : null,
    },
    update: {
      processedAt: order.processed_at ? new Date(order.processed_at) : null,
      currency: order.currency || null,
      totalPrice: Number(order.total_price || 0),
      subtotalPrice: Number(order.subtotal_price || 0),
      totalTax: Number(order.total_tax || 0),
      totalDiscounts: Number(order.total_discounts || 0),
      financialStatus: order.financial_status || null,
      fulfillmentStatus: order.fulfillment_status || null,
      customerId: linkedCustomer ? linkedCustomer.id : null,
    },
  });

  // Replace line items on each upsert for simplicity
  await prisma.shopifyOrderLineItem.deleteMany({ where: { orderId: ord.id } });
  const rows =
    (order.line_items || []).map((li: any) => ({
      orderId: ord.id,
      shopifyLineItemId: String(li.id),
      title: li.title || "",
      sku: li.sku || null,
      quantity: Number(li.quantity || 0),
      price: Number(li.price || 0),
      productId: li.product_id ? String(li.product_id) : null,
      variantId: li.variant_id ? String(li.variant_id) : null,
    })) ?? [];
  if (rows.length) await prisma.shopifyOrderLineItem.createMany({ data: rows });

  return ord;
}
