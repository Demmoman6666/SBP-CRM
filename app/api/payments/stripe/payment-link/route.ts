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
  /** NEW: reuse an existing draft instead of creating a new one */
  draftOrderId?: number | string | null;
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

// Admin GraphQL price lookup (ex-VAT)
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
    out[restId] = {
      productTitle: n.product.title,
      variantTitle: n.title,
      priceExVat: ex,
    };
  }
  return out;
}

function adminDraftUrl(id: number | null) {
  return id
    ? `https://${String(process.env.SHOPIFY_SHOP_DOMAIN || "").replace(/^https?:\/\//, "")}/admin/draft_orders/${id}`
    : null;
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

    // CRM customer (for email + Shopify linkage)
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

    // --- DRAFT: reuse if provided, otherwise create once ---
    let draftId: number | null = null;

    const incomingDraftId =
      typeof body.draftOrderId === "string" ? Number(body.draftOrderId) : Number(body.draftOrderId || 0);

    if (Number.isFinite(incomingDraftId) && incomingDraftId > 0) {
      // Try to use the passed draft, and see if it already has a link stored
      const res = await shopifyRest(`/draft_orders/${incomingDraftId}.json`, { method: "GET" });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        const draft = json?.draft_order;
        if (draft?.id) {
          draftId = Number(draft.id);

          // If a link was already generated before, reuse it (de-dupe)
          const attrs: Array<{ name?: string; value?: string }> = draft.note_attributes || [];
          const linkAttr =
            attrs.find((a) => (a.name || "").toLowerCase() === "stripepaymentlink") ||
            attrs.find((a) => (a.name || "").toLowerCase() === "stripe_payment_link");
          const url = linkAttr?.value?.trim();

          if (url) {
            return NextResponse.json(
              { url, paymentLinkId: null, draftOrderId: draftId, draftAdminUrl: adminDraftUrl(draftId) },
              { status: 200 }
            );
          }
        }
      }
    }

    // If we still don't have a draft, create it ONCE
    if (!draftId) {
      const draftPayload = {
        draft_order: {
          customer: { id: Number(crm.shopifyCustomerId) },
          use_customer_default_address: true,
          line_items: lines.map((l) => ({
            variant_id: Number(l.variantId),
            quantity: Number(l.quantity || 1),
          })),
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
      draftId = draftJson?.draft_order?.id ?? null;
    }

    // --- Build Stripe Payment Link (VAT inclusive prices) ---
    const catalog = await fetchVariantPricing(lines.map((l) => String(l.variantId)));
    const items = await Promise.all(
      lines.map(async (li) => {
        const v = catalog[String(li.variantId)];
        if (!v) throw new Error(`Variant not found in Shopify: ${li.variantId}`);
        const ex = v.priceExVat;
        const inc = ex * (1 + VAT_RATE);
        const unit_amount = Math.round(inc * 100);
        const name = `${v.productTitle} — ${v.variantTitle}`;

        const price = await stripe.prices.create({
          currency: "gbp",
          unit_amount,
          tax_behavior: "inclusive",
          product_data: { name, metadata: { variantId: String(li.variantId) } },
        });

        return { price: price.id, quantity: Number(li.quantity || 1) };
      })
    );

    const link = await stripe.paymentLinks.create({
      line_items: items,
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

    // Store the link on the draft so future clicks reuse it (de-dupe)
    if (draftId && link?.url) {
      await shopifyRest(`/draft_orders/${draftId}.json`, {
        method: "PUT",
        body: JSON.stringify({
          draft_order: {
            id: draftId,
            note: `Pending payment via Stripe Payment Link\n${link.url}`,
            note_attributes: [
              { name: "StripePaymentLink", value: link.url },
              { name: "StripePaymentLinkId", value: link.id },
            ],
          },
        }),
      }).catch(() => {});
    }

    return NextResponse.json(
      { url: link.url, paymentLinkId: link.id, draftOrderId: draftId, draftAdminUrl: adminDraftUrl(draftId) },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Stripe Payment Link error:", err);
    return NextResponse.json({ error: err?.message || "Payment Link creation failed" }, { status: 500 });
  }
}
