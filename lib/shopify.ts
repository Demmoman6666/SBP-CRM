// lib/shopify.ts
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/** ───────────────── Env ───────────────── */
const RAW_SHOP_DOMAIN = (process.env.SHOPIFY_SHOP_DOMAIN || "").trim();
const SHOP_DOMAIN = RAW_SHOP_DOMAIN.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

const SHOP_ADMIN_TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
export const SHOPIFY_API_VERSION = (process.env.SHOPIFY_API_VERSION || "2024-07").trim();

// Primary secret you set (usually the App's “API secret key”)
const WEBHOOK_SECRET = (process.env.SHOPIFY_WEBHOOK_SECRET || "").trim();

// Optional alternates in case Shopify is signing with a different secret than you expect.
const ALT_SECRET_1 = (process.env.SHOPIFY_API_SECRET_KEY || "").trim();
const ALT_SECRET_2 = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();

// Optional kill-switch for troubleshooting. DO NOT leave this enabled in production.
const DISABLE_HMAC = (process.env.SHOPIFY_DISABLE_HMAC || "") === "1";

// Optional default country when pushing to Shopify if CRM country is empty
const DEFAULT_COUNTRY_NAME = (process.env.DEFAULT_COUNTRY_NAME || "United Kingdom").trim();
const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CODE || "GB").trim();

/** Small helper: safely coerce to number */
function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Country fields helper for Shopify address payloads */
function countryFields(country?: string): { country?: string; country_code?: string } {
  if (!country) return { country: DEFAULT_COUNTRY_NAME, country_code: DEFAULT_COUNTRY_CODE };
  const s = String(country).trim();
  if (s.length === 2) return { country_code: s.toUpperCase() };
  return { country: s };
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
        console.error(`[HMAC DEBUG] matched using ${s.label} (${mask(s.value)})`);
      }
      return true;
    }
  }

  if (process.env.DEBUG_SHOPIFY_HMAC === "1") {
    const fallbackSecret = WEBHOOK_SECRET || ALT_SECRET_1 || ALT_SECRET_2 || "";
    const digestBytes = fallbackSecret
      ? crypto.createHmac("sha256", fallbackSecret).update(bodyBuf).digest()
      : Buffer.alloc(0);
    console.error("[HMAC DEBUG] mismatch", {
      provided_b64: hmacHeader.slice(0, 16) + "...",
      computed_b64: digestBytes.toString("base64").slice(0, 16) + "...",
      provided_len: Buffer.from(hmacHeader, "base64").length,
      computed_len: digestBytes.length,
      secret_used: WEBHOOK_SECRET
        ? "SHOPIFY_WEBHOOK_SECRET"
        : ALT_SECRET_1
        ? "SHOPIFY_API_SECRET_KEY"
        : ALT_SECRET_2
        ? "SHOPIFY_CLIENT_SECRET"
        : "(none set)",
      raw_len: bodyBuf.length,
    });
  }

  return false;
}

function mask(s: string) {
  if (s.length <= 8) return "********";
  return s.slice(0, 4) + "…" + s.slice(-4);
}

/** Tag → Sales Rep mapping */
export async function getSalesRepForTags(tags: string[]): Promise<string | null> {
  if (!tags || tags.length === 0) return null;

  const rule = await prisma.salesRepTagRule.findFirst({
    where: { tag: { in: tags } },
    include: { salesRep: true },
    orderBy: { createdAt: "asc" },
  });

  return rule?.salesRep?.name ?? null;
}

/** Upsert Customer from Shopify payload (pull → CRM) */
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
    country: addr.country || null, // ← NEW: persist country from Shopify
    customerEmailAddress: email,
    customerTelephone: phone,
    shopifyCustomerId: shopifyId,
    shopifyShopDomain: shopDomain,
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

/** Upsert Order + line items (pull → CRM) */
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

  if (items.length) await prisma.orderLineItem.createMany({ data: items });

  return ord;
}

/** Push CRM → Shopify (safe subset) */
export async function pushCustomerToShopifyById(crmCustomerId: string) {
  const c = await prisma.customer.findUnique({ where: { id: crmCustomerId } });
  if (!c) return;

  const parts = (c.customerName || "").trim().split(/\s+/);
  const first_name = parts[0] || "";
  const last_name = parts.slice(1).join(" ") || "";

  const cf = countryFields(c.country || undefined);

  const payload: any = {
    customer: {
      email: c.customerEmailAddress || undefined,
      phone: c.customerTelephone || undefined,
      first_name,
      last_name,
      addresses: [
        {
          default: true,
          company: c.salonName || undefined,
          address1: c.addressLine1 || undefined,
          address2: c.addressLine2 || undefined,
          city: c.town || undefined,
          province: c.county || undefined,
          zip: c.postCode || undefined,
          country: cf.country,
          country_code: cf.country_code,
        },
      ],
    },
  };

  let shopifyId = c.shopifyCustomerId || null;

  if (!shopifyId) {
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
