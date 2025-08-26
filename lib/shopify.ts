// lib/shopify.ts
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/* ----------------------------------------------------------------------------
   Minimal Shopify REST helper
---------------------------------------------------------------------------- */
const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN!;
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;

export function shopifyRest(path: string, init: RequestInit = {}) {
  const base = `https://${SHOP_DOMAIN}/admin/api/2024-07`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": ADMIN_TOKEN,
    ...(init.headers as Record<string, string> | undefined),
  };

  return fetch(`${base}${path}`, {
    ...init,
    headers,
    // don't cache any Shopify requests
    next: { revalidate: 0 },
  });
}

/* ----------------------------------------------------------------------------
   Helpers
---------------------------------------------------------------------------- */
function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((t) => t.trim()).filter(Boolean);
  if (typeof raw === "string")
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  return [];
}

/** Try DB mapping first (TagSalesRepRule), then fall back to the static rules the business requested. */
async function resolveSalesRepFromTags(tags: string[]): Promise<string | null> {
  if (!tags.length) return null;

  // Look up any DB rules that match these tags (highest priority wins)
  const rule = await prisma.tagSalesRepRule.findFirst({
    where: { tag: { in: tags } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  if (rule?.salesRepName) return rule.salesRepName;

  // Fallback static mappings requested
  const fallback: Record<string, string> = {
    alex: "Alex Krizan",
    laura: "Laura Dobbins",
    colin: "Colin Barber",
  };
  for (const t of tags) {
    const m = fallback[t.toLowerCase()];
    if (m) return m;
  }
  return null;
}

/* ----------------------------------------------------------------------------
   Upsert Customer from Shopify payload
   - Fixes TS error by using { set: [...] } when updating a string[] field
---------------------------------------------------------------------------- */
export async function upsertCustomerFromShopify(c: any, shopDomain: string) {
  const shopifyId = String(c.id);
  const email: string | null =
    (typeof c.email === "string" && c.email) ||
    (typeof c?.default_address?.email === "string" && c.default_address.email) ||
    null;

  const name =
    [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
    c?.default_address?.name ||
    email ||
    "Shopify Customer";

  const tags = normalizeTags(c.tags);
  const address = c.default_address || {};

  const rep = await resolveSalesRepFromTags(tags);

  // Try match existing CRM customer by Shopify ID or email
  const existing = await prisma.customer.findFirst({
    where: {
      OR: [
        { shopifyCustomerId: shopifyId },
        ...(email ? [{ customerEmailAddress: email }] : []),
      ],
    },
  });

  // Common field values
  const base = {
    salonName: c.company || name,
    customerName: name,
    addressLine1: String(address.address1 || "").trim(),
    addressLine2: address.address2 ? String(address.address2).trim() : null,
    town: address.city ? String(address.city).trim() : null,
    county: address.province ? String(address.province).trim() : null,
    postCode: address.zip ? String(address.zip).trim() : null,
    customerEmailAddress: email,
    customerTelephone:
      (address.phone && String(address.phone)) ||
      (c.phone && String(c.phone)) ||
      null,

    shopifyCustomerId: shopifyId,
    shopifyCustomerEmail: email,
  };

  if (existing) {
    // ⚠️ For list fields, use { set: [...] } on update
    const data: Prisma.CustomerUpdateInput = {
      salonName: base.salonName,
      customerName: base.customerName,
      addressLine1: base.addressLine1 || existing.addressLine1 || "",
      addressLine2: base.addressLine2,
      town: base.town,
      county: base.county,
      postCode: base.postCode,
      customerEmailAddress: base.customerEmailAddress,
      customerTelephone: base.customerTelephone,
      shopifyCustomerId: base.shopifyCustomerId,
      shopifyCustomerEmail: base.shopifyCustomerEmail,
      shopifyTags: { set: tags },
      ...(rep ? { salesRep: rep } : {}),
    };

    return prisma.customer.update({
      where: { id: existing.id },
      data,
    });
  } else {
    // Create accepts string[] directly for list fields
    return prisma.customer.create({
      data: {
        ...base,
        shopifyTags: tags,
        // make sure addressLine1 isn't empty on create
        addressLine1: base.addressLine1 || "—",
        ...(rep ? { salesRep: rep } : {}),
      },
    });
  }
}

/* ----------------------------------------------------------------------------
   Upsert Order from Shopify payload
---------------------------------------------------------------------------- */
export async function upsertOrderFromShopify(o: any, shopDomain: string) {
  const orderId = String(o.id);
  const exists = await prisma.shopifyOrder.findUnique({ where: { id: orderId } });

  const shopifyCustomerId = o.customer?.id ? String(o.customer.id) : null;
  const email: string | null = o.email || o.customer?.email || null;

  // Try to link to CRM customer (by Shopify ID, then by email)
  let crmCustomerId: string | null = null;
  if (shopifyCustomerId) {
    const matchByShop = await prisma.customer.findFirst({
      where: { shopifyCustomerId },
      select: { id: true },
    });
    crmCustomerId = matchByShop?.id ?? null;
  }
  if (!crmCustomerId && email) {
    const matchByEmail = await prisma.customer.findFirst({
      where: { customerEmailAddress: email },
      select: { id: true },
    });
    crmCustomerId = matchByEmail?.id ?? null;
  }

  const orderData = {
    id: orderId,
    customerId: crmCustomerId,
    shopDomain,
    number: o.number ?? null,
    name: o.name ?? null,
    email: email,
    currency: o.currency ?? null,
    totalPrice: parseFloat(o.total_price ?? 0),
    subtotalPrice: o.subtotal_price != null ? parseFloat(o.subtotal_price) : null,
    totalTax: o.total_tax != null ? parseFloat(o.total_tax) : null,
    totalDiscounts:
      o.total_discounts != null ? parseFloat(o.total_discounts) : null,
    financialStatus: o.financial_status ?? null,
    fulfillmentStatus: o.fulfillment_status ?? null,
    processedAt: o.processed_at ? new Date(o.processed_at) : null,
    createdAt: o.created_at ? new Date(o.created_at) : new Date(),
    updatedAt: o.updated_at ? new Date(o.updated_at) : new Date(),
  };

  if (exists) {
    await prisma.shopifyOrder.update({ where: { id: orderId }, data: orderData });
    // Rebuild line items to keep it simple/deterministic
    await prisma.shopifyOrderLineItem.deleteMany({ where: { orderId } });
  } else {
    await prisma.shopifyOrder.create({ data: orderData });
  }

  const items: any[] = Array.isArray(o.line_items) ? o.line_items : [];
  if (items.length) {
    await prisma.shopifyOrderLineItem.createMany({
      data: items.map((li) => ({
        id: String(li.id),
        orderId,
        productId: li.product_id ? String(li.product_id) : null,
        variantId: li.variant_id ? String(li.variant_id) : null,
        title: li.title ?? null,
        variantTitle: li.variant_title ?? null,
        sku: li.sku ?? null,
        quantity: typeof li.quantity === "number" ? li.quantity : 0,
        price: parseFloat(li.price ?? 0),
      })),
      skipDuplicates: true,
    });
  }
}
