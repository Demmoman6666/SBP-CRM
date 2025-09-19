// app/api/payments/stripe/payment-link/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyGraphql, shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PostBody =
  | { draftId: string | number; customerId?: string | null; note?: string | null }
  | { customerId: string; lines: Array<{ variantId: string; quantity: number }>; note?: string | null };

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

  const out: Record<string, { productTitle: string; variantTitle: string; priceExVat: number }> = {};
  for (const n of data.nodes || []) {
    if (!n || !("id" in n)) continue;
    const restId = n.id.replace(/^gid:\/\/shopify\/ProductVariant\//, "");
    const ex = Number(n.price || "0");
    if (!Number.isFinite(ex)) throw new Error(`Invalid price for variant ${restId}`);
    out[restId] = { productTitle: n.product.title, variantTitle: n.title, priceExVat: ex };
  }
  return out;
}

async function loadDraft(draftId: string | number) {
  const res = await shopifyRest(`/draft_orders/${draftId}.json`, { method: "GET" });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Failed to fetch draft: ${res.status} ${text}`);
  const json = JSON.parse(text);
  return json?.draft_order as any;
}

async function createLinkFromDraft(stripe: Stripe, draft: any, origin: string) {
  const items = draft?.line_items || [];
  if (!Array.isArray(items) || items.length === 0) throw new Error("Draft has no line items");

  const line_items: Stripe.PaymentLinkCreateParams.LineItem[] = [];

  for (const li of items) {
    const unitEx = Number(li?.price ?? 0);
    const unitInc = unitEx * (1 + VAT_RATE);
    const amount = Math.round(unitInc * 100);
    const name = `${li?.title ?? "Item"}${li?.variant_title ? ` — ${li.variant_title}` : ""}`;

    const price = await stripe.prices.create({
      currency: "gbp",
      unit_amount: amount,
      tax_behavior: "inclusive",
      product_data: {
        name,
        metadata: {
          variantId: li?.variant_id ? String(li.variant_id) : "",
          crmDraftOrderId: draft?.id ? String(draft.id) : "",
        },
      },
    });

    line_items.push({ price: price.id, quantity: Number(li?.quantity || 1) });
  }

  const meta = {
    crmDraftOrderId: String(draft?.id || ""),
    shopifyCustomerId: draft?.customer?.id ? String(draft.customer.id) : "",
    source: "SBP-CRM",
  };

  const link = await stripe.paymentLinks.create({
    line_items,
    after_completion: { type: "redirect", redirect: { url: `${origin}/orders/new?paid=1` } },
    metadata: meta,
    payment_intent_data: { metadata: meta },
    automatic_tax: { enabled: false },
  });

  const adminDraftUrl = draft?.id
    ? `https://${(process.env.SHOPIFY_SHOP_DOMAIN || "").replace(/^https?:\/\//, "")}/admin/draft_orders/${draft.id}`
    : null;

  return { url: link.url, paymentLinkId: link.id, draftOrderId: draft?.id ?? null, draftAdminUrl: adminDraftUrl };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const draftId = url.searchParams.get("draftId");
  if (!draftId) return NextResponse.json({ error: "Missing draftId" }, { status: 400 });

  const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
  if (!stripeSecret) return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });

  try {
    const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });
    const draft = await loadDraft(draftId);
    const { url: linkUrl } = await createLinkFromDraft(stripe, draft, getOrigin(req));
    return NextResponse.redirect(linkUrl, { status: 303 }); // open directly
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Payment Link creation failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
  if (!stripeSecret) return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });
  const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });
  const origin = getOrigin(req);

  const body = (await req.json().catch(() => ({}))) as PostBody;

  // --- Draft mode (preferred) -------------------------------------------------
  if ("draftId" in body && body.draftId) {
    try {
      const draft = await loadDraft(body.draftId);
      const result = await createLinkFromDraft(stripe, draft, origin);
      return NextResponse.json(result, { status: 200 });
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || "Payment Link creation failed" }, { status: 500 });
    }
  }

  // --- Legacy mode: create draft from { customerId, lines } then link --------
  const { customerId, lines } = body as Extract<PostBody, { customerId: string; lines: any[] }>;
  if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
  }

  try {
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

    // 1) Create Shopify draft from posted lines
    const draftPayload = {
      draft_order: {
        customer: { id: Number(crm.shopifyCustomerId) },
        use_customer_default_address: true,
        line_items: lines.map((l) => ({ variant_id: Number(l.variantId), quantity: Number(l.quantity || 1) })),
        tags: "CRM, StripeLink, Pending",
        note: `Pending payment via Stripe Payment Link`,
        note_attributes: [
          { name: "Source", value: "CRM" },
          { name: "Payment", value: "Stripe Payment Link" },
        ],
      },
    };
    const draftRes = await shopifyRest(`/draft_orders.json`, { method: "POST", body: JSON.stringify(draftPayload) });
    const draftText = await draftRes.text().catch(() => "");
    if (!draftRes.ok) {
      return NextResponse.json(
        { error: `Shopify draft create failed: ${draftRes.status} ${draftText}` },
        { status: 502 }
      );
    }
    const draftJson = JSON.parse(draftText);
    const draftId: number | null = draftJson?.draft_order?.id ?? null;

    // 2) Price catalog (ex-VAT) for the posted variants
    const catalog = await fetchVariantPricing(lines.map((l) => String(l.variantId)));

    // 3) Create prices (VAT-inclusive) and build link
    const line_items: Stripe.PaymentLinkCreateParams.LineItem[] = [];
    for (const li of lines) {
      const v = catalog[String(li.variantId)];
      if (!v) throw new Error(`Variant not found in Shopify: ${li.variantId}`);
      const inc = v.priceExVat * (1 + VAT_RATE);
      const unit_amount = Math.round(inc * 100);
      const name = `${v.productTitle} — ${v.variantTitle}`;

      const price = await stripe.prices.create({
        currency: "gbp",
        unit_amount,
        tax_behavior: "inclusive",
        product_data: { name, metadata: { variantId: String(li.variantId) } },
      });

      line_items.push({ price: price.id, quantity: Number(li.quantity || 1) });
    }

    const link = await stripe.paymentLinks.create({
      line_items,
      after_completion: {
        type: "redirect",
        redirect: { url: `${origin}/customers/${customerId}?paid=1&session_id={CHECKOUT_SESSION_ID}` },
      },
      metadata: {
        crmCustomerId: crm.id,
        shopifyCustomerId: crm.shopifyCustomerId || "",
        crmDraftOrderId: draftId ? String(draftId) : "",
        source: "SBP-CRM",
      },
    });

    if (draftId && link?.url) {
      await shopifyRest(`/draft_orders/${draftId}.json`, {
        method: "PUT",
        body: JSON.stringify({ draft_order: { id: draftId, note: `Pending payment via Stripe Payment Link\n${link.url}` } }),
      }).catch(() => {});
    }

    const adminDraftUrl = draftId
      ? `https://${(process.env.SHOPIFY_SHOP_DOMAIN || "").replace(/^https?:\/\//, "")}/admin/draft_orders/${draftId}`
      : null;

    return NextResponse.json(
      { url: link.url, paymentLinkId: link.id, draftOrderId: draftId, draftAdminUrl: adminDraftUrl },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Stripe Payment Link error:", err);
    return NextResponse.json({ error: err?.message || "Payment Link creation failed" }, { status: 500 });
  }
}
