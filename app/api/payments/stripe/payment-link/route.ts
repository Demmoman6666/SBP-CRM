// app/api/payments/stripe/payment-link/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyGraphql, shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PostBody = {
  customerId: string;
  lines: Array<{ variantId: string; quantity: number }>;
  note?: string | null;
};

const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

function getOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    return (process.env.APP_URL || `${u.protocol}//${u.host}`).replace(/\/$/, "");
  } catch {
    return process.env.APP_URL || "http://localhost:3000";
  }
}

// Secure price lookup from Shopify Admin GraphQL (ex-VAT)
async function fetchVariantPricing(variantIds: string[]) {
  if (!variantIds.length) return {};
  const ids = variantIds.map((id) => `gid://shopify/ProductVariant/${id}`);

  const query = `
    query VariantReprice($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          title
          price
          product { title }
        }
      }
    }
  `;
  const data = await shopifyGraphql<{
    nodes: Array<
      | {
          __typename?: "ProductVariant";
          id: string;
          title: string;
          price: string | null;
          product: { title: string };
        }
      | null
    >;
  }>(query, { ids });

  const out: Record<
    string,
    { productTitle: string; variantTitle: string; priceExVat: number }
  > = {};
  for (const n of data.nodes || []) {
    if (!n || !("id" in n)) continue;
    const restId = n.id.replace(/^gid:\/\/shopify\/ProductVariant\//, "");
    const ex = Number(n.price || "0");
    if (!Number.isFinite(ex)) throw new Error(`Invalid price for variant ${restId}`);
    out[restId] = {
      productTitle: n.product.title,
      variantTitle: n.title,
      priceExVat: ex,
    };
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
    if (!stripeSecret) {
      return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });
    }
    const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

    const origin = getOrigin(req);

    const body = (await req.json()) as PostBody;
    const { customerId, lines } = body || ({} as any);

    if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
    }

    // Load CRM customer (for email and Shopify id)
    const crm = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        salonName: true,
        customerName: true,
        customerEmailAddress: true,
        shopifyCustomerId: true,
      },
    });
    if (!crm) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    if (!crm.shopifyCustomerId) {
      return NextResponse.json(
        { error: "Customer is not linked to Shopify (missing shopifyCustomerId)" },
        { status: 400 }
      );
    }

    // 1) Create the Shopify DRAFT ORDER (so staff can see it immediately)
    const draftPayload = {
      draft_order: {
        customer: { id: Number(crm.shopifyCustomerId) },
        use_customer_default_address: true,
        line_items: lines.map((l) => ({
          variant_id: Number(l.variantId),
          quantity: Number(l.quantity || 1),
        })),
        // Shopify expects a comma-separated STRING for tags
        tags: "CRM, StripeLink, Pending",
        note: `Pending payment via Stripe Payment Link`,
        note_attributes: [
          { name: "Source", value: "CRM" },
          { name: "Payment", value: "Stripe Payment Link" },
        ],
      },
    };
    const draftRes = await shopifyRest(`/draft_orders.json`, {
      method: "POST",
      body: JSON.stringify(draftPayload),
    });
    const draftText = await draftRes.text().catch(() => "");
    if (!draftRes.ok) {
      return NextResponse.json(
        { error: `Shopify draft create failed: ${draftRes.status} ${draftText}` },
        { status: 502 }
      );
    }
    const draftJson = JSON.parse(draftText);
    const draftId: number | null = draftJson?.draft_order?.id ?? null;

    // 2) Build Stripe Prices (VAT-inclusive) and create a Payment Link that carries the draft id
    const catalog = await fetchVariantPricing(lines.map((l) => String(l.variantId)));

    // create ephemeral prices for each line (VAT inclusive)
    const items = await Promise.all(
      lines.map(async (li) => {
        const v = catalog[String(li.variantId)];
        if (!v) throw new Error(`Variant not found in Shopify: ${li.variantId}`);

        const ex = v.priceExVat;
        const inc = ex * (1 + VAT_RATE);
        const unit_amount = Math.round(inc * 100); // pence
        const name = `${v.productTitle} — ${v.variantTitle}`;

        const price = await stripe.prices.create({
          currency: "gbp",
          unit_amount,
          tax_behavior: "inclusive",
          product_data: {
            name,
            metadata: { variantId: String(li.variantId) },
          },
        });

        return { price: price.id, quantity: Number(li.quantity || 1) };
      })
    );

    const link = await stripe.paymentLinks.create({
      line_items: items, // array of { price, quantity }
      after_completion: {
        type: "redirect",
        redirect: {
          url: `${origin}/customers/${customerId}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
        },
      },
      metadata: {
        crmCustomerId: crm.id,
        shopifyCustomerId: crm.shopifyCustomerId || "",
        crmDraftOrderId: draftId ? String(draftId) : "",
        source: "SBP-CRM",
      },
    });

    // (Optional) Update draft note to include the link
    if (draftId && link?.url) {
      await shopifyRest(`/draft_orders/${draftId}.json`, {
        method: "PUT",
        body: JSON.stringify({
          draft_order: {
            id: draftId,
            note: `Pending payment via Stripe Payment Link\n${link.url}`,
          },
        }),
      }).catch(() => {});
    }

    const adminDraftUrl = draftId
      ? `https://${process.env.SHOPIFY_SHOP_DOMAIN?.replace(/^https?:\/\//, "")}/admin/draft_orders/${draftId}`
      : null;

    return NextResponse.json(
      { url: link.url, paymentLinkId: link.id, draftOrderId: draftId, draftAdminUrl: adminDraftUrl },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Stripe Payment Link error:", err);
    return NextResponse.json(
      { error: err?.message || "Payment Link creation failed" },
      { status: 500 }
    );
  }
}
