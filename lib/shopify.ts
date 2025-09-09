import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/** ───────────────── Env ───────────────── */
const RAW_SHOP_DOMAIN = (process.env.SHOPIFY_SHOP_DOMAIN || "").trim();
const SHOP_DOMAIN = RAW_SHOP_DOMAIN.replace(/^https?:\/\//i, "");
const SHOP_ADMIN_TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
export const SHOPIFY_API_VERSION = (process.env.SHOPIFY_API_VERSION || "2024-07").trim();
const WEBHOOK_SECRET = (process.env.SHOPIFY_WEBHOOK_SECRET || "").trim();
const ALT_SECRET_1 = (process.env.SHOPIFY_API_SECRET_KEY || "").trim();
const ALT_SECRET_2 = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
const DISABLE_HMAC = (process.env.SHOPIFY_DISABLE_HMAC || "") === "1";

/** Utils */
function toNumber(v: any): number | null { if (v==null) return null; const n=Number(v); return Number.isFinite(n)?n:null; }
export function parseShopifyTags(input: any): string[] {
  if (Array.isArray(input)) return input.map(String).map(s=>s.trim()).filter(Boolean);
  if (typeof input === "string") return input.split(",").map(s=>s.trim()).filter(Boolean);
  return [];
}
function tagsToString(tags: string[]) { return Array.from(new Set(tags.map(t=>t.trim()).filter(Boolean))).join(", "); }

/** REST Admin */
export async function shopifyRest(path: string, init: RequestInit = {}) {
  if (!SHOP_DOMAIN || !SHOP_ADMIN_TOKEN) throw new Error("Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN");
  const url = `https://${SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const headers = new Headers(init.headers as any);
  headers.set("X-Shopify-Access-Token", SHOP_ADMIN_TOKEN);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  return fetch(url, { ...init, headers, cache: "no-store" });
}

/** HMAC */
function verifyWithSecret(secret: string, rawBytes: Buffer, hmacHeader: string) {
  if (!secret) return false;
  const providedBytes = Buffer.from(hmacHeader, "base64");
  const digestBytes = crypto.createHmac("sha256", secret).update(rawBytes).digest();
  try { return providedBytes.length===digestBytes.length && crypto.timingSafeEqual(providedBytes, digestBytes); }
  catch { return false; }
}
export function verifyShopifyHmac(rawBody: ArrayBuffer|Buffer|string, hmacHeader?: string|null) {
  if (DISABLE_HMAC) return true;
  if (!hmacHeader) return false;
  const bodyBuf = typeof rawBody==="string" ? Buffer.from(rawBody,"utf8")
                 : Buffer.isBuffer(rawBody) ? rawBody
                 : Buffer.from(rawBody as ArrayBuffer);
  const secrets = [WEBHOOK_SECRET, ALT_SECRET_1, ALT_SECRET_2].filter(Boolean);
  for (const s of secrets) if (verifyWithSecret(s, bodyBuf, hmacHeader)) return true;
  return false;
}

/** Sales Rep mapping */
export async function getSalesRepForTags(tags: string[]): Promise<string | null> {
  if (!tags || !tags.length) return null;
  const norm = tags.map(t=>t.trim()).filter(Boolean);

  const rule = await prisma.salesRepTagRule.findFirst({
    where: { tag: { in: norm } }, include: { salesRep: true }, orderBy: { createdAt: "asc" },
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

/** Fetch full Shopify customer by id (ensures tags present) */
async function fetchShopifyCustomerById(shopifyId: string): Promise<any | null> {
  if (!shopifyId) return null;
  const res = await shopifyRest(`/customers/${shopifyId}.json`, { method: "GET" });
  if (!res.ok) { console.warn(`[WEBHOOK] GET /customers/${shopifyId}.json -> ${res.status}`); return null; }
  const json = await res.json();
  return json?.customer ?? null;
}

/** Pull a numeric Shopify customer id from various shapes */
export function extractShopifyCustomerId(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;
  if (payload.customer_id != null) return String(payload.customer_id);                // tag events
  if (payload.customer?.id != null) return String(payload.customer.id);              // nested
  if (payload.id != null && typeof payload.id !== "object") return String(payload.id);
  const gid: string | undefined = payload.admin_graphql_api_id || payload.customer?.admin_graphql_api_id;
  if (gid && typeof gid === "string") {
    const m = gid.match(/\/Customer\/(\d+)$/);
    if (m) return m[1];
  }
  return null;
}

/** Upsert helpers */
type UpsertOpts = {
  updateOnly?: boolean;
  matchBy?: "shopifyIdOnly" | "shopifyIdOrEmail";
};

export async function upsertCustomerFromShopifyById(
  shopCustomerId: string,
  _shopDomain: string,
  opts?: UpsertOpts
) {
  const full = await fetchShopifyCustomerById(shopCustomerId);
  if (!full) { console.warn(`[WEBHOOK] fetch failed for Shopify customer ${shopCustomerId}`); return; }
  await upsertCustomerFromShopify(full, _shopDomain, opts);
}

/**
 * Main upsert. Always maps tags → salesRep.
 * - For create/update payloads with full tags, this just works.
 * - For tag events we call the *_ById version so `full.tags` is present.
 */
export async function upsertCustomerFromShopify(shop: any, _shopDomain: string, opts?: UpsertOpts) {
  const shopifyId = extractShopifyCustomerId(shop);
  const email: string | null = (shop.email || "").toLowerCase() || null;

  const addr = shop.default_address || {};
  const fullName = [shop.first_name, shop.last_name].filter(Boolean).join(" ").trim();
  const company = addr.company || "";
  const phone = shop.phone || addr.phone || null;

  const tags = "tags" in shop ? parseShopifyTags(shop.tags) : [];
  const repName = await getSalesRepForTags(tags);

  const base = {
    salonName: company || fullName || "Shopify Customer",
    customerName: fullName || company || "Unknown",
    addressLine1: addr.address1 || "",
    addressLine2: addr.address2 || null,
    town: addr.city || null,
    county: addr.province || null,
    postCode: addr.zip || null,
    country: addr.country || null,
    customerEmailAddress: email,
    customerTelephone: phone,
    shopifyCustomerId: shopifyId || null,
  };

  // Find existing CRM record
  let existing: { id: string } | null = null;
  if (shopifyId) {
    existing = await prisma.customer.findFirst({ where: { shopifyCustomerId: shopifyId } });
  }
  if (!existing && (opts?.matchBy ?? "shopifyIdOrEmail") === "shopifyIdOrEmail" && email) {
    existing = await prisma.customer.findFirst({ where: { customerEmailAddress: email } });
  }

  if (existing) {
    const data: any = { ...base, shopifyTags: { set: tags } };
    if (repName) data.salesRep = repName;

    await prisma.customer.update({ where: { id: existing.id }, data });
    console.info(`[WEBHOOK] CRM updated id=${existing.id} → rep=${repName ?? "-"}`);
    return;
  }

  if (opts?.updateOnly) {
    // Don’t create for tag-only events
    console.info(`[WEBHOOK] updateOnly=true, no CRM match for shopifyId=${shopifyId ?? "-"}, email=${email ?? "-"}`);
    return;
  }

  const createData: any = { ...base, shopifyTags: tags };
  if (repName) createData.salesRep = repName;

  const created = await prisma.customer.create({ data: createData });
  console.info(`[WEBHOOK] CRM created id=${created.id} → rep=${repName ?? "-"}`);
}

/** Orders (unchanged) */
export async function upsertOrderFromShopify(order: any, _shopDomain: string) {
  const orderId = String(order.id);
  const custShopId = order.customer ? String(order.customer.id) : null;
  const linkedCustomer =
    custShopId ? await prisma.customer.findFirst({ where: { shopifyCustomerId: custShopId } }) : null;

  const shippingFromSet =
    order?.total_shipping_price_set?.shop_money?.amount ??
    order?.total_shipping_price_set?.presentment_money?.amount ?? null;
  const shipping = toNumber(shippingFromSet) ?? toNumber(order?.shipping_lines?.[0]?.price) ?? null;

  const ord = await prisma.order.upsert({
    where: { shopifyOrderId: orderId },
    create: {
      shopifyOrderId: orderId,
      shopifyOrderNumber: order.order_number ?? null,
      shopifyName: order.name ?? null,
      shopifyCustomerId: custShopId ?? null,
      customerId: linkedCustomer ? linkedCustomer.id : null,
      processedAt: order.processed_at ? new Date(order.processed_at)
        : order.created_at ? new Date(order.created_at) : null,
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
      shopifyCustomerId: custShopId ?? null,
      customerId: linkedCustomer ? linkedCustomer.id : null,
      processedAt: order.processed_at ? new Date(order.processed_at)
        : order.created_at ? new Date(order.created_at) : null,
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

  const itemsData = (order.line_items || []).map((li: any) => ({
    orderId: ord.id,
    shopifyLineItemId: li.id ? String(li.id) : null,
    productId: li.product_id ? String(li.product_id) : null,
    productTitle: li.title ?? null,
    variantId: li.variant_id ? String(li.variant_id) : null,
    variantTitle: li.variant_title ?? null,
    sku: li.sku ?? null,
    productVendor: li.vendor ?? null,
    quantity: Number(li.quantity ?? 0),
    price: toNumber(li.price),
    total: (toNumber(li.price) ?? 0) * Number(li.quantity ?? 0),
  }));
  if (itemsData.length) await prisma.orderLineItem.createMany({ data: itemsData });

  return ord;
}
