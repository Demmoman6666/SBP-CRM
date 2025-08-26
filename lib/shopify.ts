// lib/shopify.ts
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN!;
const SHOP_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET!;

/** Small helper: safely coerce to number */
function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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
    include: { salesRep: true },
    orderBy: { createdAt: "asc" }, // deterministic tie-breaker
  });

  return rule?.salesRep?.name ?? null;
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
export async function upsertOrderFromShopify(order: any, _shopDomain: string) {
  const orderId = String(order.id);
  const custShopId = order.customer ? String(order.customer.id) : null;

  const linkedCustomer =
    custShopId ? await prisma.customer.findFirst({ where: { shopifyCustomerId: custShopId } }) : null;

  // Compute shipping (best-effort)
  const shippingFromSet =
    order?.total_shipping_price_set?.shop_money?.amount ??
    order?.total_shipping_price_set?.presentment_money?.amount ??
    null;
  const shipping = toNumber(shippingFromSet) ?? toNumber(order?.shipping_lines?.[0]?.price) ?? null;

  // Upsert the order (uses prisma.order — matches your schema)
  const ord = await prisma.order.upsert({
    where: { shopifyOrderId: orderId },
    create: {
      shopifyOrderId: orderId,
      shopifyOrderNumber: order.order_number ?? null,
      shopifyName: order.name ?? null,

      customerId: linkedCustomer ? linkedCustomer.id : null,

      processedAt: order.processed_at
        ? new Date(order.processed_at)
        : order.created_at
        ? new Date(order.created_at)
        : null,

      currency: order.currency ?? null,
      financialStatus: order.financial_status ?? null,
      fulfillmentStatus: order.fulfillment_status ?? null,

      subtotal: toNumber(order.subtotal_price),
      total: toNumber(order.total_price),
      taxes: toNumber(order.total_tax),
      discounts: toNumber(order.total_discounts),
      shipping,
    },
    update: {
      shopifyOrderNumber: order.order_number ?? null,
      shopifyName: order.name ?? null,

      customerId: linkedCustomer ? linkedCustomer.id : null,

      processedAt: order.processed_at
        ? new Date(order.processed_at)
        : order.created_at
        ? new Date(order.created_at)
        : null,

      currency: order.currency ?? null,
      financialStatus: order.financial_status ?? null,
      fulfillmentStatus: order.fulfillment_status ?? null,

      subtotal: toNumber(order.subtotal_price),
      total: toNumber(order.total_price),
      taxes: toNumber(order.total_tax),
      discounts: toNumber(order.total_discounts),
      shipping,
    },
  });

  // Replace line items on each upsert for simplicity
  await prisma.orderLineItem.deleteMany({ where: { orderId: ord.id } });

  const items =
    (order.line_items || []).map((li: any) => {
      const qty = Number(li.quantity ?? 0);
      const unit = toNumber(li.price);
      const total = unit != null ? (qty ? unit * qty : unit) : null;

      return {
        orderId: ord.id,
        shopifyLineItemId: li.id ? String(li.id) : null,
        productId: li.product_id ? String(li.product_id) : null,
        productTitle: li.title ?? null,
        variantId: li.variant_id ? String(li.variant_id) : null,
        variantTitle: li.variant_title ?? null,
        sku: li.sku ?? null,
        quantity: qty,
        price: unit,
        total,
      };
    }) ?? [];

  if (items.length) {
    await prisma.orderLineItem.createMany({ data: items });
  }

  return ord;
}

/** ───────────────────────────────────────────────────────────
 *  CRM → Shopify push (safe subset: contact + default address)
 *  This will create the Shopify customer if missing, otherwise update it.
 *  Does NOT alter tags yet.
 *  ─────────────────────────────────────────────────────────── */
export async function pushCustomerToShopifyById(crmCustomerId: string) {
  const c = await prisma.customer.findUnique({ where: { id: crmCustomerId } });
  if (!c) return;

  // Split a first/last name guess from your customerName (Shopify likes it that way)
  const parts = (c.customerName || "").trim().split(/\s+/);
  const first_name = parts[0] || "";
  const last_name = parts.slice(1).join(" ") || "";

  const payload: any = {
    customer: {
      email: c.customerEmailAddress || undefined,
      phone: c.customerTelephone || undefined,
      first_name,
      last_name,
      // keep company/salon on the default address
      addresses: [
        {
          default: true,
          company: c.salonName || undefined,
          address1: c.addressLine1 || undefined,
          address2: c.addressLine2 || undefined,
          city: c.town || undefined,
          province: c.county || undefined,
          zip: c.postCode || undefined,
        },
      ],
    },
  };

  // Create or Update
  let shopifyId = c.shopifyCustomerId || null;

  if (!shopifyId) {
    // Create
    const res = await shopifyRest(`/customers.json`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Shopify create failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    shopifyId = String(json?.customer?.id ?? "");
    if (shopifyId) {
      await prisma.customer.update({
        where: { id: c.id },
        data: {
          shopifyCustomerId: shopifyId,
          shopifyLastSyncedAt: new Date(),
          // mirror tags we got back (if present)
          shopifyTags: json?.customer?.tags
            ? String(json.customer.tags)
                .split(",")
                .map((t: string) => t.trim())
                .filter(Boolean)
            : c.shopifyTags ?? [],
        },
      });
    }
  } else {
    // Update
    const res = await shopifyRest(`/customers/${shopifyId}.json`, {
      method: "PUT",
      body: JSON.stringify({
        customer: { id: Number(shopifyId), ...payload.customer },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Shopify update failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    await prisma.customer.update({
      where: { id: c.id },
      data: {
        shopifyLastSyncedAt: new Date(),
        shopifyTags: json?.customer?.tags
          ? String(json.customer.tags)
              .split(",")
              .map((t: string) => t.trim())
              .filter(Boolean)
          : c.shopifyTags ?? [],
      },
    });
  }
}
