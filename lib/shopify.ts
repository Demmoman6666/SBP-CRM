// lib/shopify.ts
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/** ───────────────── Env ───────────────── */
const RAW_SHOP_DOMAIN = (process.env.SHOPIFY_SHOP_DOMAIN || "").trim();
const SHOP_DOMAIN = RAW_SHOP_DOMAIN.replace(/^https?:\/\//i, "");

const SHOP_ADMIN_TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
export const SHOPIFY_API_VERSION = (process.env.SHOPIFY_API_VERSION || "2024-07").trim();

// Primary secret you set (usually the App's “API secret key”)
const WEBHOOK_SECRET = (process.env.SHOPIFY_WEBHOOK_SECRET || "").trim();

// Optional alternates in case Shopify is signing with a different secret than you expect.
const ALT_SECRET_1 = (process.env.SHOPIFY_API_SECRET_KEY || "").trim();
const ALT_SECRET_2 = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();

// Optional kill-switch for troubleshooting. DO NOT leave this enabled in production.
const DISABLE_HMAC = (process.env.SHOPIFY_DISABLE_HMAC || "") === "1";

/** Small helper: safely coerce to number */
function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Tag helpers */
function parseShopifyTags(input: any): string[] {
  if (Array.isArray(input)) {
    return input.map(String).map(s => s.trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
  }
  return [];
}
function tagsToString(tags: string[]): string {
  const uniq = Array.from(new Set(tags.map(t => t.trim()).filter(Boolean)));
  return uniq.join(", ");
}

/** Call Shopify REST Admin API */
export async function shopifyRest(path: string, init: RequestInit = {}) {
  if (!SHOP_DOMAIN || !SHOP_ADMIN_TOKEN) {
    throw new Error("Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN");
  }
  const url = `https://${SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const headers = new Headers(init.headers as any);
  headers.set("X-Shopify-Access-Token", SHOP_ADMIN_TOKEN);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  return fetch(url, { ...init, headers, cache: "no-store" });
}

/** --- Cache + helper to fetch product.vendor when a line item doesn't include it --- */
const vendorCache = new Map<string, string | null>();

async function fetchProductVendor(productId: string): Promise<string | null> {
  if (!productId) return null;
  if (vendorCache.has(productId)) return vendorCache.get(productId)!;

  try {
    const res = await shopifyRest(`/products/${productId}.json`, { method: "GET" });
    if (!res.ok) { vendorCache.set(productId, null); return null; }
    const json = await res.json();
    const v = (json?.product?.vendor || "").toString().trim() || null;
    vendorCache.set(productId, v);
    return v;
  } catch {
    vendorCache.set(productId, null);
    return null;
  }
}

/** Internal helper: compute & compare HMAC with a specific secret */
function verifyWithSecret(secret: string, rawBytes: Buffer, hmacHeader: string) {
  if (!secret) return false;
  const providedBytes = Buffer.from(hmacHeader, "base64");
  const digestBytes = crypto.createHmac("sha256", secret).update(rawBytes).digest();

  try {
    return (
      providedBytes.length === digestBytes.length &&
      crypto.timingSafeEqual(providedBytes, digestBytes)
    );
  } catch {
    return false;
  }
}

/** Verify Shopify webhook HMAC — byte-safe + optional debug + alternate secrets */
export function verifyShopifyHmac(
  rawBody: ArrayBuffer | Buffer | string,
  hmacHeader?: string | null
) {
  if (DISABLE_HMAC) return true; // ⚠️ troubleshooting only
  if (!hmacHeader) return false;

  const bodyBuf =
    typeof rawBody === "string"
      ? Buffer.from(rawBody, "utf8")
      : Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(rawBody as ArrayBuffer);

  const secretsTried = [
    { label: "SHOPIFY_WEBHOOK_SECRET", value: WEBHOOK_SECRET },
    { label: "SHOPIFY_API_SECRET_KEY", value: ALT_SECRET_1 },
    { label: "SHOPIFY_CLIENT_SECRET", value: ALT_SECRET_2 },
  ].filter(s => !!s.value);

  for (const s of secretsTried) {
    if (verifyWithSecret(s.value, bodyBuf, hmacHeader)) {
      if (process.env.DEBUG_SHOPIFY_HMAC === "1") {
        console.error(`[HMAC DEBUG] matched using ${s.label}`);
      }
      return true;
    }
  }

  if (process.env.DEBUG_SHOPIFY_HMAC === "1") {
    const digestBytes = crypto
      .createHmac("sha256", WEBHOOK_SECRET || ALT_SECRET_1 || ALT_SECRET_2)
      .update(bodyBuf)
      .digest();
    console.error("[HMAC DEBUG] mismatch", {
      provided_b64: hmacHeader.slice(0, 16) + "...",
      computed_b64: digestBytes.toString("base64").slice(0, 16) + "...",
      provided_len: Buffer.from(hmacHeader, "base64").length,
      computed_len: digestBytes.length,
      raw_len: bodyBuf.length,
    });
  }

  return false;
}

/** ───────────────── Sales Rep ↔ Tag mapping helpers ───────────────── */

/** 1) Map incoming Shopify tags → a SalesRep.name (via rules, then fallback to matching names) */
export async function getSalesRepForTags(tags: string[]): Promise<string | null> {
  if (!tags || tags.length === 0) return null;
  const norm = tags.map(t => t.trim()).filter(Boolean);

  const rule = await prisma.salesRepTagRule.findFirst({
    where: { tag: { in: norm } },
    include: { salesRep: true },
    orderBy: { createdAt: "asc" },
  });
  if (rule?.salesRep?.name) return rule.salesRep.name;

  const reps = await prisma.salesRep.findMany({ select: { name: true } });
  const byLower = new Map(reps.map(r => [r.name.toLowerCase(), r.name]));
  for (const t of norm) {
    const hit = byLower.get(t.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** 2) For pushing CRM → Shopify, pick the tag string we should apply for a given sales rep name */
async function tagForSalesRepName(repName: string): Promise<string> {
  const rep = await prisma.salesRep.findFirst({
    where: { name: repName },
    select: { id: true, name: true },
  });
  if (!rep) return repName;

  const rule = await prisma.salesRepTagRule.findFirst({
    where: { salesRepId: rep.id },
    select: { tag: true },
  });
  return (rule?.tag?.trim()) || rep.name;
}

/** 3) Universe of “rep tags” to strip/replace when updating Shopify tags */
async function allRepTagsToStripLower(): Promise<Set<string>> {
  const [rules, reps] = await Promise.all([
    prisma.salesRepTagRule.findMany({ select: { tag: true } }),
    prisma.salesRep.findMany({ select: { name: true } }),
  ]);
  const s = new Set<string>();
  for (const r of rules) if (r.tag) s.add(r.tag.toLowerCase().trim());
  for (const r of reps) if (r.name) s.add(r.name.toLowerCase().trim());
  return s;
}

/** 4) Read current Shopify tags for a customer ID */
async function fetchShopifyCustomerTags(shopifyId: string): Promise<string[]> {
  const res = await shopifyRest(`/customers/${shopifyId}.json`, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET customer ${shopifyId} failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  return parseShopifyTags(json?.customer?.tags);
}

/** ───────────────── Inbound upserts (Shopify → CRM) ───────────────── */

/** Upsert Customer from Shopify payload */
export async function upsertCustomerFromShopify(shop: any, _shopDomain: string) {
  const shopifyId = String(shop.id);
  const email: string | null = (shop.email || "").toLowerCase() || null;

  const addr = shop.default_address || {};
  const fullName = [shop.first_name, shop.last_name].filter(Boolean).join(" ").trim();
  const company = addr.company || "";
  const phone = shop.phone || addr.phone || null;

  const tags: string[] = parseShopifyTags(shop.tags);
  const mappedRep = await getSalesRepForTags(tags);

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
    country: addr.country || null,
    customerEmailAddress: email,
    customerTelephone: phone,
    shopifyCustomerId: shopifyId,
  };

  const byShopId = await prisma.customer.findFirst({ where: { shopifyCustomerId: shopifyId } });
  if (byShopId) {
    const updateData: any = { ...base, shopifyTags: { set: tags } };
    if (mappedRep) updateData.salesRep = mappedRep;
    return prisma.customer.update({ where: { id: byShopId.id }, data: updateData });
  }

  if (email) {
    const byEmail = await prisma.customer.findFirst({ where: { customerEmailAddress: email } });
    if (byEmail) {
      const updateData: any = { ...base, shopifyTags: { set: tags } };
      if (mappedRep) updateData.salesRep = mappedRep;
      return prisma.customer.update({ where: { id: byEmail.id }, data: updateData });
    }
  }

  const createData: any = { ...base, shopifyTags: tags };
  if (mappedRep) createData.salesRep = mappedRep;
  return prisma.customer.create({ data: createData });
}

/** Upsert Order + line items (Shopify → CRM) */
export async function upsertOrderFromShopify(order: any, _shopDomain: string) {
  const orderId = String(order.id);
  const custShopId = order.customer ? String(order.customer.id) : null;

  const linkedCustomer =
    custShopId ? await prisma.customer.findFirst({ where: { shopifyCustomerId: custShopId } }) : null;

  const shippingFromSet =
    order?.total_shipping_price_set?.shop_money?.amount ??
    order?.total_shipping_price_set?.presentment_money?.amount ??
    null;
  const shipping = toNumber(shippingFromSet) ?? toNumber(order?.shipping_lines?.[0]?.price) ?? null;

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

  await prisma.orderLineItem.deleteMany({ where: { orderId: ord.id } });

  // Build line items, ensuring productVendor is captured (from LI or product lookup)
  const itemsData = await Promise.all(
    (order.line_items || []).map(async (li: any) => {
      const qty = Number(li.quantity ?? 0);
      const unit = toNumber(li.price);
      const total = unit != null ? (qty ? unit * qty : unit) : null;

      let productVendor: string | null = li.vendor ?? null;
      const pid = li.product_id ? String(li.product_id) : "";
      if (!productVendor && pid) {
        productVendor = await fetchProductVendor(pid);
      }

      return {
        orderId: ord.id,
        shopifyLineItemId: li.id ? String(li.id) : null,
        productId: pid || null,
        productTitle: li.title ?? null,
        variantId: li.variant_id ? String(li.variant_id) : null,
        variantTitle: li.variant_title ?? null,
        sku: li.sku ?? null,
        productVendor,
        quantity: qty,
        price: unit,
        total,
      };
    })
  );

  if (itemsData.length) {
    await prisma.orderLineItem.createMany({ data: itemsData });
  }

  return ord;
}

/** ───────────────── Outbound push (CRM → Shopify) ───────────────── */

/**
 * Push CRM → Shopify (safe subset) including Sales Rep tag maintenance.
 * - Create Shopify customer if missing; else update.
 * - Keep all non-rep tags, remove old rep tags, add current rep’s tag (rule.tag or rep.name).
 */
export async function pushCustomerToShopifyById(crmCustomerId: string) {
  const c = await prisma.customer.findUnique({ where: { id: crmCustomerId } });
  if (!c) return;

  const parts = (c.customerName || "").trim().split(/\s+/);
  const first_name = parts[0] || "";
  const last_name = parts.slice(1).join(" ") || "";

  const baseAddress = {
    default: true,
    company: c.salonName || undefined,
    address1: c.addressLine1 || undefined,
    address2: c.addressLine2 || undefined,
    city: c.town || undefined,
    province: c.county || undefined,
    country: c.country || undefined,
    zip: c.postCode || undefined,
  };

  const currentRep = (c.salesRep || "").trim();
  const repTag = currentRep ? (await tagForSalesRepName(currentRep)) : null;

  let existingShopifyId = c.shopifyCustomerId || null;
  let existingTags: string[] = [];
  if (existingShopifyId) {
    try {
      existingTags = await fetchShopifyCustomerTags(existingShopifyId);
    } catch {
      existingTags = [];
    }
  }

  const repUniverse = await allRepTagsToStripLower();
  const kept = existingTags.filter(t => !repUniverse.has(t.toLowerCase().trim()));
  const newTags = repTag ? [...kept, repTag] : kept;

  const payload: any = {
    customer: {
      email: c.customerEmailAddress || undefined,
      phone: c.customerTelephone || undefined,
      first_name,
      last_name,
      addresses: [baseAddress],
      tags: tagsToString(newTags),
    },
  };

  if (!existingShopifyId) {
    const res = await shopifyRest(`/customers.json`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Shopify create failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    const shopifyId = String(json?.customer?.id ?? "");
    if (shopifyId) {
      await prisma.customer.update({
        where: { id: c.id },
        data: {
          shopifyCustomerId: shopifyId,
          shopifyLastSyncedAt: new Date(),
          shopifyTags: parseShopifyTags(json?.customer?.tags),
        },
      });
    }
  } else {
    const res = await shopifyRest(`/customers/${existingShopifyId}.json`, {
      method: "PUT",
      body: JSON.stringify({
        customer: { id: Number(existingShopifyId), ...payload.customer },
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
        shopifyTags: parseShopifyTags(json?.customer?.tags),
      },
    });
  }
}
