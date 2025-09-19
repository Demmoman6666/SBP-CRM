// app/api/payments/stripe/checkout/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyGraphql, shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PostBody =
  | { draftId: string | number; customerId?: string | null; note?: string | null }
  | { customerId: string; lines: Array<{ variantId: string; quantity: number }>; note?: string | null };

// VAT: Shopify prices are ex VAT; Stripe unit_amount will be gross (inc VAT)
const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

function getOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    return (process.env.APP_URL || `${u.protocol}//${u.host}`).replace(/\/$/, "");
  } catch {
    return process.env.APP_URL || "http://localhost:3000";
  }
}

/** Trusted price lookup direct from Shopify Admin GraphQL — returns ex-VAT */
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

  const out: Record<string, { productTitle: string; variantTitle: string; priceExVat: number }> = {};
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

/** Fetch a Shopify draft order (REST) */
async function loadDraft(draftId: string | number) {
  const res = await shopifyRest(`/draft_orders/${draftId}.json`, { method: "GET" });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Failed to fetch draft: ${res.status} ${text}`);
  const json = JSON.parse(text);
  return json?.draft_order as any;
}

/** Create a Checkout Session *from an existing draft* (preferred flow) */
async function createCheckoutFromDraft(req: Request, draftId: string | number) {
  const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
  if (!stripeSecret) return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY env var" }, { status: 500 });
  const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

  const origin = getOrigin(req);
  const draft = await loadDraft(draftId);

  const items = draft?.line_items || [];
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Draft has no line items" }, { status: 400 });
  }

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((li: any) => ({
    quantity: Number(li?.quantity || 1),
    price_data: {
      currency: "gbp",
      // Shopify draft line_items[].price is ex-VAT; convert to inc-VAT for Stripe
      unit_amount: Math.round(Number(li?.price ?? 0) * (1 + VAT_RATE) * 100),
      product_data: {
        name: `${li?.title ?? "Item"}${li?.variant_title ? ` — ${li.variant_title}` : ""}`,
        metadata: {
          variantId: li?.variant_id ? String(li.variant_id) : "",
          crmDraftOrderId: String(draftId),
        },
      },
    },
  }));

  const meta = {
    crmDraftOrderId: String(draftId),
    shopifyCustomerId: draft?.customer?.id ? String(draft.customer.id) : "",
    source: "SBP-CRM",
  };

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items,
    // we may not know the CRM id here, so bounce back to the builder
    success_url: `${origin}/orders/new?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/orders/new`,
    metadata: meta,
    payment_intent_data: { metadata: meta },
    // automatic_tax disabled — prices are already VAT-inclusive
  });

  if (req.method === "GET") {
    // Directly open Checkout when called via GET (used by your “Pay by card” button)
    return NextResponse.redirect(session.url!, { status: 303 });
  }
  return NextResponse.json({ url: session.url, draftOrderId: Number(draftId) }, { status: 200 });
}

/** GET — allow /api/payments/stripe/checkout?draftId=123 to open Stripe directly */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const draftId = url.searchParams.get("draftId");
  if (!draftId) return NextResponse.json({ error: "Missing draftId" }, { status: 400 });
  try {
    return await createCheckoutFromDraft(req, draftId);
  } catch (err: any) {
    console.error("Stripe checkout (GET) error:", err);
    return NextResponse.json({ error: err?.message || "Stripe checkout failed" }, { status: 500 });
  }
}

/** POST — supports BOTH:
 *  (A) { draftId }  -> build from draft (preferred)
 *  (B) { customerId, lines } -> legacy flow: price from Shopify and build directly
 */
export async function POST(req: Request) {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
    if (!stripeSecret) {
      return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY env var" }, { status: 500 });
    }
    const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });
    const origin = getOrigin(req);

    const body = (await req.json().catch(() => ({}))) as PostBody;

    // --- (A) Preferred: draft-backed checkout --------------------------------
    if ("draftId" in body && body.draftId) {
      return await createCheckoutFromDraft(req, String(body.draftId));
    }

    // --- (B) Legacy: direct lines --------------------------------------------
    const { customerId, lines } = body as Extract<PostBody, { customerId: string; lines: any[] }>;

    if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
    }
    for (const li of lines) {
      if (!li?.variantId) return NextResponse.json({ error: "Each line must include variantId" }, { status: 400 });
      if (!Number.isFinite(Number(li.quantity)) || Number(li.quantity) <= 0) {
        return NextResponse.json({ error: "Each line must include a positive quantity" }, { status: 400 });
      }
    }

    const crm = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, salonName: true, customerName: true, customerEmailAddress: true, shopifyCustomerId: true },
    });
    if (!crm) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    // Secure prices from Shopify (ex VAT)
    const ids = lines.map((l) => String(l.variantId));
    const catalog = await fetchVariantPricing(ids);

    // Build Stripe Checkout line items (gross, inc VAT), and attach variantId to product metadata
    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = lines.map((li) => {
      const v = catalog[String(li.variantId)];
      if (!v) throw new Error(`Variant not found in Shopify: ${li.variantId}`);

      const inc = v.priceExVat * (1 + VAT_RATE);
      return {
        quantity: Number(li.quantity || 1),
        price_data: {
          currency: "gbp",
          unit_amount: Math.round(inc * 100),
          product_data: {
            name: `${v.productTitle} — ${v.variantTitle}`,
            metadata: { variantId: String(li.variantId) },
          },
        },
      };
    });

    const sharedMeta = {
      crmCustomerId: crm.id,
      shopifyCustomerId: crm.shopifyCustomerId || "",
      source: "SBP-CRM",
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_email: crm.customerEmailAddress || undefined,
      success_url: `${origin}/customers/${customerId}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/orders/new?customerId=${customerId}`,
      metadata: sharedMeta,
      payment_intent_data: {
        metadata: sharedMeta,
        receipt_email: crm.customerEmailAddress || undefined,
      },
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (err: any) {
    console.error("Stripe checkout (POST) error:", err);
    return NextResponse.json({ error: err?.message || "Stripe checkout failed" }, { status: 500 });
  }
}
