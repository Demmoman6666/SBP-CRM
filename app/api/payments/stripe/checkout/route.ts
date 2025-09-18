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

// 20% VAT by default (prices in Shopify are ex VAT)
const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

// Build an origin for success/cancel URLs
function getOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    return (process.env.APP_URL || `${u.protocol}//${u.host}`).replace(/\/$/, "");
  } catch {
    return process.env.APP_URL || "http://localhost:3000";
  }
}

// Given REST numeric ids, fetch trusted price/title via Admin GraphQL
async function fetchVariantPricing(
  variantIds: string[]
): Promise<
  Record<
    string,
    {
      productTitle: string;
      variantTitle: string;
      priceExVat: number; // numeric £
    }
  >
> {
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
    if (!Number.isFinite(ex)) throw new Error(`Invalid price for variant ${restId}`);
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
      return NextResponse.json(
        { error: "Missing STRIPE_SECRET_KEY env var" },
        { status: 500 }
      );
    }

    // Pin to a version compatible with your installed stripe types
    const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

    const origin = getOrigin(req);

    const body = (await req.json()) as PostBody;
    const { customerId, lines } = body || ({} as any);

    if (!customerId) {
      return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json(
        { error: "At least one line item is required" },
        { status: 400 }
      );
    }

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
    if (!crm) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Secure re-pricing from Shopify
    const ids = lines.map((l) => String(l.variantId));
    const catalog = await fetchVariantPricing(ids);

    // Build Stripe line_items (include variantId in metadata so webhook can create Shopify order)
    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = lines.map(
      (li) => {
        const v = catalog[String(li.variantId)];
        if (!v) {
          throw new Error(`Variant not found in Shopify: ${li.variantId}`);
        }
        const ex = v.priceExVat; // £
        const inc = ex * (1 + VAT_RATE);
        const unit_amount = Math.round(inc * 100); // pence
        const name = `${v.productTitle} — ${v.variantTitle}`;

        return {
          quantity: Number(li.quantity || 1),
          price_data: {
            currency: "gbp",
            unit_amount,
            product_data: {
              name,
              // 👇 critical: carry Shopify variant id so the webhook can build the order
              metadata: {
                variantId: String(li.variantId),
              },
            },
          },
        };
      }
    );

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_email: crm.customerEmailAddress || undefined,
      success_url: `${origin}/customers/${customerId}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/orders/new?customerId=${customerId}`,
      metadata: {
        crmCustomerId: crm.id,
        shopifyCustomerId: crm.shopifyCustomerId || "",
        source: "SBP-CRM",
      },
      // If you want automatic tax by Stripe instead, flip this on and remove your own VAT math:
      // automatic_tax: { enabled: true },
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (err: any) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json(
      { error: err?.message || "Stripe checkout failed" },
      { status: 500 }
    );
  }
}
