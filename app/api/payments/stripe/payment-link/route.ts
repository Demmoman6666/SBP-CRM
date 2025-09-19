// app/api/payments/stripe/payment-link/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PostBody = {
  customerId: string;
  lines: Array<{ variantId: string; quantity: number }>;
  note?: string | null;
};

// Prices from Shopify are ex VAT; we sell to customer inc VAT
const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

function getOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    return (process.env.APP_URL || `${u.protocol}//${u.host}`).replace(/\/$/, "");
  } catch {
    return process.env.APP_URL || "http://localhost:3000";
  }
}

// Fetch trusted prices from Shopify Admin GraphQL (variant.price is scalar string)
async function fetchVariantPricing(variantIds: string[]) {
  if (!variantIds.length) return {};
  const gids = variantIds.map((id) => `gid://shopify/ProductVariant/${id}`);

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
  }>(query, { ids: gids });

  const out: Record<
    string,
    { productTitle: string; variantTitle: string; priceExVat: number }
  > = {};
  for (const node of data.nodes || []) {
    if (!node || !("id" in node)) continue;
    const restId = node.id.replace(/^gid:\/\/shopify\/ProductVariant\//, "");
    const ex = Number(node.price || "0");
    if (!Number.isFinite(ex)) {
      throw new Error(`Invalid price for variant ${restId}`);
    }
    out[restId] = {
      productTitle: node.product.title,
      variantTitle: node.title,
      priceExVat: ex,
    };
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
    if (!stripeSecret) {
      return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY env var" }, { status: 500 });
    }
    // Pin API version to avoid TS build mismatch on Vercel
    const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

    const body = (await req.json()) as PostBody;
    const { customerId, lines } = body || ({} as any);

    if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
    }

    const crm = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, shopifyCustomerId: true, customerEmailAddress: true },
    });
    if (!crm) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    // Secure prices from Shopify
    const ids = lines.map((l) => String(l.variantId));
    const catalog = await fetchVariantPricing(ids);

    // Build Payment Link line items (inc VAT; price_data allowed for Payment Links)
    const line_items: Stripe.PaymentLinkCreateParams.LineItem[] = lines.map((li) => {
      const v = catalog[String(li.variantId)];
      if (!v) throw new Error(`Variant not found in Shopify: ${li.variantId}`);
      const ex = v.priceExVat;
      const inc = ex * (1 + VAT_RATE);
      const unit_amount = Math.round(inc * 100); // pence

      return {
        quantity: Number(li.quantity || 1),
        price_data: {
          currency: "gbp",
          unit_amount,
          tax_behavior: "inclusive", // we’re passing VAT-included prices
          product_data: {
            name: `${v.productTitle} — ${v.variantTitle}`,
            // This metadata is retrievable from the session’s line items in the webhook
            metadata: {
              variantId: String(li.variantId),
            },
          },
        },
      };
    });

    const origin = getOrigin(req);
    const link = await stripe.paymentLinks.create({
      line_items,
      after_completion: {
        type: "redirect",
        redirect: {
          // Checkout Sessions created from the Payment Link will populate this token
          url: `${origin}/customers/${customerId}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
        },
      },
      metadata: {
        crmCustomerId: crm.id,
        shopifyCustomerId: crm.shopifyCustomerId || "",
        source: "SBP-CRM",
      },
      // We’re not enabling automatic tax because we already include VAT in unit_amount.
    });

    return NextResponse.json({ url: link.url, id: link.id }, { status: 200 });
  } catch (err: any) {
    console.error("Stripe payment link error:", err);
    return NextResponse.json(
      { error: err?.message || "Payment Link creation failed" },
      { status: 500 }
    );
  }
}
