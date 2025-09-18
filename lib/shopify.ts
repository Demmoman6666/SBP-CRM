// lib/shopify.ts
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

/** ───────────────── Small utils ───────────────── */
function toNumber(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseShopifyTags(input: any): string[] {
  if (Array.isArray(input)) return input.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof input === "string") return input.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}
function tagsToString(tags: string[]): string {
  return Array.from(new Set(tags.map(t => t.trim()).filter(Boolean))).join(", ");
}

/** Convert a GraphQL gid (e.g. gid://shopify/Product/123456789) → "123456789" */
export function gidToNumericId(gid?: string | null): string | null {
  if (!gid || typeof gid !== "string") return null;
  const m = gid.match(/\/(\d+)$/);
  return m ? m[1] : null;
}

/** ───────────────── REST Admin helper ───────────────── */
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

/** ───────────────── GraphQL Admin helper ───────────────── */
export async function shopifyGraphql<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
  if (!SHOP_DOMAIN || !SHOP_ADMIN_TOKEN) {
    throw new Error("Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN");
  }
  const url = `https://${SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      "X-Shopify-Access-Token": SHOP_ADMIN_TOKEN,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json?.errors) {
    throw new Error(`Shopify GraphQL error: ${res.status} ${JSON.stringify(json?.errors || json)}`);
  }
  return json.data as T;
}

/* ➕ Alias export to satisfy imports that use `shopifyGraphQL` (capital QL) */
export { shopifyGraphql as shopifyGraphQL };

/** ───────────────── HMAC ───────────────── */
function verifyWithSecret(secret: string, rawBytes: Buffer, hmacHeader: string) {
  if (!secret) return false;
  const providedBytes = Buffer.from(hmacHeader, "base64");
  const digestBytes = crypto.createHmac("sha256", secret).update(rawBytes).digest();
  try {
    return providedBytes.length === digestBytes.length && crypto.timingSafeEqual(providedBytes, digestBytes);
  } catch {
    return false;
  }
}
export function verifyShopifyHmac(rawBody: ArrayBuffer | Buffer | string, hmacHeader?: string | null) {
  if (DISABLE_HMAC) return true;
  if (!hmacHeader) return false;
  const bodyBuf =
    typeof rawBody === "string"
      ? Buffer.from(rawBody, "utf8")
      : Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(rawBody as ArrayBuffer);
  const secrets = [WEBHOOK_SECRET, ALT_SECRET_1, ALT_SECRET_2].filter(Boolean);
  for (const s of secrets) if (verifyWithSecret(s, bodyBuf, hmacHeader)) return true;
  return false;
}

/** ───────────────── Sales Rep mapping ───────────────── */
export async function getSalesRepForTags(tags: string[]): Promise<string | null> {
  if (!tags?.length) return null;
  const norm = tags.map(t => t.trim()).filter(Boolean);

  // 1) Rule table: allows aliases (e.g., “Colin” → “Colin Barber”)
  const rule = await prisma.salesRepTagRule.findFirst({
    where: { tag: { in: norm } },
    include: { salesRep: true },
    orderBy: { createdAt: "asc" },
  });
  if (rule?.salesRep?.name) return rule.salesRep.name;

  // 2) Fallback: direct match to SalesRep.name
  const reps = await prisma.salesRep.findMany({ select: { name: true } });
  const byLower = new Map(reps.map(r => [r.name.toLowerCase(), r.name]));
  for (const t of norm) {
    const hit = byLower.get(t.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** ───────────────── Customer fetch / id helpers ───────────────── */
async function fetchShopifyCustomerById(shopifyId: string): Promise<any | null> {
  if (!shopifyId) return null;
  const res = await shopifyRest(`/customers/${shopifyId}.json`, { method: "GET" });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.customer ?? null;
}

/** Extract numeric Shopify customer id from various payload shapes */
export function extractShopifyCustomerId(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;
  if (payload.customer_id != null) return String(payload.customer_id);               // tag webhooks
  if (payload.customer?.id != null) return String(payload.customer.id);             // nested
  if (payload.id != null && typeof payload.id !== "object") return String(payload.id); // direct
  const gid: string | undefined =
    payload.admin_graphql_api_id || payload.customer?.admin_graphql_api_id;
  if (gid && typeof gid === "string") {
    const m = gid.match(/\/Customer\/(\d+)$/);
    if (m) return m[1];
  }
  return null;
}

/** ───────────────── Inbound upserts (Shopify → CRM) ───────────────── */
type UpsertOpts = {
  updateOnly?: boolean; // if true, do not create CRM customers when no match found
  matchBy?: "shopifyIdOnly" | "shopifyIdOrEmail";
};

export async function upsertCustomerFromShopifyById(
  shopCustomerId: string,
  _shopDomain: string,
  opts?: UpsertOpts
) {
  const full = await fetchShopifyCustomerById(shopCustomerId);
  if (!full) {
    console.warn(`[WEBHOOK] fetch failed for Shopify customer ${shopCustomerId}`);
    return;
  }
  await upsertCustomerFromShopify(full, _shopDomain, opts);
}

export async function upsertCustomerFromShopify(
  shop: any,
  _shopDomain: string,
  opts?: UpsertOpts
) {
  const shopifyId = extractShopifyCustomerId(shop);
  const email: string | null = (shop.email || "").toLowerCase() || null;

  const addr = shop.default_address || {};
  const fullName = [shop.first_name, shop.last_name].filter(Boolean).join(" ").trim();
  const company = addr.company || "";
  const phone = shop.phone || addr.phone || null;

  // If Shopify didn't include tags on this webhook, treat as empty array (we won’t clear CRM tags unless we fetched full record)
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

  const matchMode = opts?.matchBy ?? "shopifyIdOrEmail";
  let existing: { id: string } | null = null;
  if (shopifyId) {
    existing = await prisma.customer.findFirst({ where: { shopifyCustomerId: shopifyId } });
  }
  if (!existing && matchMode === "shopifyIdOrEmail" && email) {
    existing = await prisma.customer.findFirst({ where: { customerEmailAddress: email } });
  }

  if (existing) {
    const data: any = { ...base };
    // Only update shopifyTags if this payload actually carried tags
    if ("tags" in shop) data.shopifyTags = { set: tags };
    if (repName) data.salesRep = repName;

    await prisma.customer.update({ where: { id: existing.id }, data });
    return;
  }

  if (opts?.updateOnly) {
    // No match and we were told not to create
    return;
  }

  const createData: any = { ...base };
  if ("tags" in shop) createData.shopifyTags = tags;
  if (repName) createData.salesRep = repName;

  await prisma.customer.create({ data: createData });
}

/** Orders (Shopify → CRM) */
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

  const itemsData = (order.line_items || []).map((li: any) => {
    const qty = Number(li.quantity ?? 0);
    const unit = toNumber(li.price);
    return {
      orderId: ord.id,
      shopifyLineItemId: li.id ? String(li.id) : null,
      productId: li.product_id ? String(li.product_id) : null,
      productTitle: li.title ?? null,
      variantId: li.variant_id ? String(li.variant_id) : null,
      variantTitle: li.variant_title ?? null,
      sku: li.sku ?? null,
      productVendor: li.vendor ?? null,
      quantity: qty,
      price: unit,
      total: unit != null ? (qty ? unit * qty : unit) : null,
    };
  });

  if (itemsData.length) await prisma.orderLineItem.createMany({ data: itemsData });

  return ord;
}

/** ───────────────── Outbound push (CRM → Shopify) ───────────────── */
async function tagForSalesRepName(repName: string): Promise<string> {
  const rep = await prisma.salesRep.findFirst({ where: { name: repName }, select: { id: true, name: true } });
  if (!rep) return repName;
  const rule = await prisma.salesRepTagRule.findFirst({ where: { salesRepId: rep.id }, select: { tag: true } });
  return (rule?.tag?.trim()) || rep.name;
}
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
async function fetchShopifyCustomerTags(shopifyId: string): Promise<string[]> {
  const res = await shopifyRest(`/customers/${shopifyId}.json`, { method: "GET" });
  if (!res.ok) return [];
  const json = await res.json();
  return parseShopifyTags(json?.customer?.tags);
}

/** Keep this export because your /api/customers/[id] route imports it */
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
    try { existingTags = await fetchShopifyCustomerTags(existingShopifyId); } catch { existingTags = []; }
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
    const res = await shopifyRest(`/customers.json`, { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`Shopify create failed: ${res.status} ${await res.text().catch(()=>"")}`);
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
      body: JSON.stringify({ customer: { id: Number(existingShopifyId), ...payload.customer } }),
    });
    if (!res.ok) throw new Error(`Shopify update failed: ${res.status} ${await res.text().catch(()=>"")}`);
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

/* ──────────────────────────────────────────────────────────────────
   Product Search (Admin GraphQL) for “Create Order”
   - searchShopifyCatalog(term) returns flattened variants + product info
   - createDraftOrderForCustomer(...) to stage an order in Shopify
   ────────────────────────────────────────────────────────────────── */

export type ShopifySearchVariant = {
  productGid: string;
  productId: string | null;
  productTitle: string;
  vendor: string | null;
  imageUrl: string | null;
  status: string | null;

  variantGid: string;
  variantId: string | null;
  variantTitle: string;
  sku: string | null;
  barcode: string | null;

  priceAmount: string | null;
  currencyCode: string | null;

  availableForSale: boolean | null;
  inventoryQuantity: number | null;
};

function buildProductQueryString(term: string): string {
  const t = term.replace(/"/g, '\\"').trim();
  if (!t) return "";
  // Match in title, sku, or vendor
  return `title:*${t}* OR sku:*${t}* OR vendor:*${t}*`;
}

export async function searchShopifyCatalog(term: string, first = 15): Promise<ShopifySearchVariant[]> {
  const q = buildProductQueryString(term);
  if (!q) return [];

  const query = `
    query SearchProducts($q: String!, $first: Int!) {
      products(first: $first, query: $q) {
        edges {
          node {
            id
            title
            vendor
            status
            images(first: 1) { edges { node { url } } }
            variants(first: 50) {
              edges {
                node {
                  id
                  title
                  sku
                  barcode
                  availableForSale
                  inventoryQuantity
                  price { amount currencyCode }
                }
              }
            }
          }
        }
      }
    }
  `;

  type Gx = {
    products: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          vendor?: string | null;
          status?: string | null;
          images?: { edges: { node: { url: string } }[] } | null;
          variants: {
            edges: Array<{
              node: {
                id: string;
                title: string;
                sku?: string | null;
                barcode?: string | null;
                availableForSale?: boolean | null;
                inventoryQuantity?: number | null;
                price?: { amount: string; currencyCode: string } | null;
              };
            }>;
          };
        };
      }>;
    };
  };

  const data = await shopifyGraphql<Gx>(query, { q, first });
  const out: ShopifySearchVariant[] = [];
  for (const pe of data?.products?.edges || []) {
    const p = pe.node;
    const productId = gidToNumericId(p.id);
    const img = p.images?.edges?.[0]?.node?.url || null;

    for (const ve of p.variants?.edges || []) {
      const v = ve.node;
      out.push({
        productGid: p.id,
        productId,
        productTitle: p.title,
        vendor: p.vendor ?? null,
        imageUrl: img,
        status: p.status ?? null,

        variantGid: v.id,
        variantId: gidToNumericId(v.id),
        variantTitle: v.title,
        sku: v.sku ?? null,
        barcode: v.barcode ?? null,

        priceAmount: v.price?.amount ?? null,
        currencyCode: v.price?.currencyCode ?? null,

        availableForSale: v.availableForSale ?? null,
        inventoryQuantity: typeof v.inventoryQuantity === "number" ? v.inventoryQuantity : null,
      });
    }
  }
  return out;
}

/** Create a Draft Order in Shopify for a CRM customer by their id */
export async function createDraftOrderForCustomer(
  crmCustomerId: string,
  items: Array<{ variantId: string; quantity: number }>,
  note?: string
) {
  // We require a Shopify customer id on the CRM record
  const customer = await prisma.customer.findUnique({
    where: { id: crmCustomerId },
    select: { shopifyCustomerId: true, customerEmailAddress: true, salonName: true, customerName: true },
  });
  if (!customer) throw new Error("Customer not found");
  if (!customer.shopifyCustomerId) throw new Error("This customer is not linked to a Shopify customer");

  // Draft order payload
  const line_items = items.map(li => ({
    variant_id: Number(li.variantId),
    quantity: li.quantity,
  }));

  const payload = {
    draft_order: {
      customer: { id: Number(customer.shopifyCustomerId) },
      line_items,
      note: note || undefined,
      tags: "CRM",
      use_customer_default_address: true,
    },
  };

  const res = await shopifyRest(`/draft_orders.json`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Draft order create failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  return json?.draft_order || null;
}
