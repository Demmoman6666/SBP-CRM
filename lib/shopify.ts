// lib/shopify.ts
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

const SHOP = process.env.SHOPIFY_SHOP_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-07";

export function verifyShopifyHmac(rawBody: Buffer, headerHmac: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET!;
  if (!headerHmac) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(headerHmac));
}

// Minimal REST wrapper
export async function shopifyRest(path: string, init?: RequestInit) {
  if (!SHOP || !TOKEN) throw new Error("Shopify env vars not set");
  const url = `https://${SHOP}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    // Keep-alive disabled to play nice with serverless
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify ${res.status} ${res.statusText}: ${text}`);
  }
  return res;
}

/** Map Shopify tags -> salesRep name */
export function mapTagsToRep(tagsStr?: string | null): string | null {
  if (!tagsStr) return null;
  const tags = tagsStr.split(",").map(t => t.trim().toLowerCase());
  if (tags.includes("alex"))  return "Alex Krizan";
  if (tags.includes("laura")) return "Laura Dobbins";
  if (tags.includes("colin")) return "Colin Barber";
  return null;
}

/** Upsert a CRM customer from a Shopify customer payload */
export async function upsertCustomerFromShopify(shopCustomer: any, shopDomain: string) {
  const defAddr = shopCustomer.default_address || {};
  const tags = (shopCustomer.tags ?? "") as string;

  // Build CRM fields
  const customerEmailAddress = shopCustomer.email ?? null;
  const customerTelephone = shopCustomer.phone ?? defAddr.phone ?? null;
  const customerName = [shopCustomer.first_name, shopCustomer.last_name].filter(Boolean).join(" ") || shopCustomer.display_name || "Shopify Customer";
  const salonName = defAddr.company || shopCustomer.company || shopCustomer.display_name || customerName;

  const data = {
    salonName,
    customerName,
    addressLine1: defAddr.address1 ?? "",
    addressLine2: defAddr.address2 ?? null,
    town: defAddr.city ?? null,
    county: defAddr.province ?? null,
    postCode: defAddr.zip ?? null,
    customerEmailAddress,
    customerTelephone,
    shopifyCustomerId: String(shopCustomer.id),
    shopifyShopDomain: shopDomain,
    shopifyUpdatedAt: shopCustomer.updated_at ? new Date(shopCustomer.updated_at) : new Date(),
    shopifyTags: tags,
  } as const;

  // Sales rep mapping from tags
  const rep = mapTagsToRep(tags);
  if (rep) (data as any).salesRep = rep;

  // Try link by shopifyCustomerId, else email
  const byShopId = await prisma.customer.findUnique({ where: { shopifyCustomerId: String(shopCustomer.id) } });
  if (byShopId) {
    return prisma.customer.update({
      where: { id: byShopId.id },
      data,
    });
  }

  if (customerEmailAddress) {
    const byEmail = await prisma.customer.findFirst({ where: { customerEmailAddress } });
    if (byEmail) {
      return prisma.customer.update({ where: { id: byEmail.id }, data });
    }
  }

  // Create if not found
  return prisma.customer.create({ data: { ...data, addressLine1: data.addressLine1 || "-" } });
}

/** Push a CRM customer TO Shopify (create or update) */
export async function pushCustomerToShopify(cust: any) {
  if (!SHOP || !TOKEN) return; // silently skip if not configured
  // Shopify requires at least email or phone
  if (!cust.customerEmailAddress && !cust.customerTelephone) return;

  const payload = {
    customer: {
      id: cust.shopifyCustomerId ? Number(cust.shopifyCustomerId) : undefined,
      first_name: cust.customerName?.split(" ").slice(0, -1).join(" ") || cust.customerName,
      last_name: cust.customerName?.split(" ").slice(-1)[0] || undefined,
      email: cust.customerEmailAddress || undefined,
      phone: cust.customerTelephone || undefined,
      tags: buildTagsFromRep(cust.salesRep, cust.shopifyTags),
      addresses: [
        {
          address1: cust.addressLine1 || undefined,
          address2: cust.addressLine2 || undefined,
          city: cust.town || undefined,
          province: cust.county || undefined,
          zip: cust.postCode || undefined,
          company: cust.salonName || undefined,
          default: true,
        },
      ],
    },
  };

  if (cust.shopifyCustomerId) {
    // Update
    const res = await shopifyRest(`/customers/${cust.shopifyCustomerId}.json`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    await prisma.customer.update({
      where: { id: cust.id },
      data: {
        shopifyUpdatedAt: json.customer.updated_at ? new Date(json.customer.updated_at) : new Date(),
        shopifyTags: json.customer.tags || null,
      },
    });
  } else {
    // Create
    const res = await shopifyRest(`/customers.json`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    await prisma.customer.update({
      where: { id: cust.id },
      data: {
        shopifyCustomerId: String(json.customer.id),
        shopifyShopDomain: SHOP,
        shopifyUpdatedAt: json.customer.updated_at ? new Date(json.customer.updated_at) : new Date(),
        shopifyTags: json.customer.tags || null,
      },
    });
  }
}

function buildTagsFromRep(salesRep?: string | null, existing?: string | null): string | undefined {
  const tags = new Set(
    (existing || "")
      .split(",")
      .map(t => t.trim())
      .filter(Boolean)
  );
  // Ensure rep tag is present based on mapping
  if (salesRep) {
    const lookup: Record<string, string> = {
      "Alex Krizan": "Alex",
      "Laura Dobbins": "Laura",
      "Colin Barber": "Colin",
    };
    const t = lookup[salesRep];
    if (t) tags.add(t);
  }
  return Array.from(tags).join(", ") || undefined;
}

/** Upsert Order + LineItems from Shopify order payload */
export async function upsertOrderFromShopify(order: any, shopDomain: string) {
  // Link to CRM customer if possible
  let crmCustomerId: string | null = null;
  const shopCustId = order.customer?.id ? String(order.customer.id) : null;

  if (shopCustId) {
    const found = await prisma.customer.findFirst({ where: { shopifyCustomerId: shopCustId } });
    if (found) crmCustomerId = found.id;
  }
  if (!crmCustomerId && order.email) {
    const byEmail = await prisma.customer.findFirst({ where: { customerEmailAddress: order.email } });
    if (byEmail) crmCustomerId = byEmail.id;
  }

  const base = {
    shopifyId: String(order.id),
    shopDomain,
    orderNumber: order.order_number ? String(order.order_number) : null,
    createdAtShop: new Date(order.created_at),
    financialStatus: order.financial_status || null,
    fulfillmentStatus: order.fulfillment_status || null,
    currency: order.currency || null,
    totalPrice: order.total_price ? Number(order.total_price) : null,
    customerId: crmCustomerId,
    email: order.email || null,
    phone: order.phone || null,
  };

  // Upsert order
  const saved = await prisma.order.upsert({
    where: { shopifyId: String(order.id) },
    create: base as any,
    update: base as any,
  });

  // Replace line items
  await prisma.orderLineItem.deleteMany({ where: { orderId: saved.id } });
  const items = (order.line_items || []) as any[];
  if (items.length) {
    await prisma.orderLineItem.createMany({
      data: items.map(li => ({
        orderId: saved.id,
        shopifyLineId: li.id ? String(li.id) : null,
        productId: li.product_id ? String(li.product_id) : null,
        variantId: li.variant_id ? String(li.variant_id) : null,
        sku: li.sku || null,
        title: li.title || null,
        quantity: typeof li.quantity === "number" ? li.quantity : null,
        price: li.price ? Number(li.price) : null,
      })),
      skipDuplicates: true,
    });
  }

  return saved;
}
