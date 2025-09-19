// app/api/webhooks/stripe/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyRest, shopifyGraphql, upsertOrderFromShopify } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 20% by default — override with VAT_RATE in your env if needed
const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

function toMoney(n: number) {
  return Number(n.toFixed(2));
}
function upper(s?: string | null) {
  return (s || "").toUpperCase();
}

/** After first successful payment, disable the Payment Link to prevent re-use */
async function disablePaymentLinkIfPresent(session: Stripe.Checkout.Session) {
  const sk = process.env.STRIPE_SECRET_KEY!;
  const stripe = new Stripe(sk, { apiVersion: "2023-10-16" });

  const linkId =
    (typeof session.payment_link === "string" && session.payment_link) ||
    (session.payment_link as any)?.id ||
    null;

  if (!linkId) return;
  try {
    await stripe.paymentLinks.update(linkId, { active: false });
  } catch (e) {
    console.warn("paymentLinks.update failed (ignored):", e);
  }
}

/** Fallback path: create a NEW paid Shopify order straight from the session (no draft) */
async function createPaidShopifyOrderFromSession(session: Stripe.Checkout.Session) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

  const crmCustomerId = String(session.metadata?.crmCustomerId || "");
  const shopifyCustomerId = String(session.metadata?.shopifyCustomerId || "");
  if (!crmCustomerId || !shopifyCustomerId)
    throw new Error("Missing customer ids in session metadata");

  const full = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items.data.price.product"],
  });

  const currency = upper(full.currency) || "GBP";

  type ShopifyLine = {
    variant_id: number;
    quantity: number;
    price: number; // unit ex VAT
    taxable?: boolean;
    tax_lines: Array<{ title: string; rate: number; price: number }>;
  };

  const shopifyLines: ShopifyLine[] = [];
  let totalTax = 0;

  for (const li of full.line_items?.data || []) {
    const qty = Number(li.quantity || 1);
    const unitInc =
      li.amount_total && qty > 0
        ? li.amount_total / 100 / qty
        : (li.price?.unit_amount ?? 0) / 100;

    const unitEx = unitInc / (1 + VAT_RATE);
    const lineEx = unitEx * qty;
    const lineTax = lineEx * VAT_RATE;

    let variantId: string | undefined;
    if (li.price && typeof li.price.product === "object") {
      variantId = (li.price.product as Stripe.Product).metadata?.variantId;
    }
    if (!variantId) throw new Error("Missing variantId on Stripe product metadata");

    shopifyLines.push({
      variant_id: Number(variantId),
      quantity: qty,
      price: toMoney(unitEx),
      taxable: true,
      tax_lines: [{ title: "VAT", rate: VAT_RATE, price: toMoney(lineTax) }],
    });

    totalTax += lineTax;
  }

  const payload: any = {
    order: {
      customer: { id: Number(shopifyCustomerId) },
      line_items: shopifyLines,
      currency,
      taxes_included: false,
      total_tax: toMoney(totalTax),
      financial_status: "paid",
      use_customer_default_address: true,
      note: `Stripe Checkout ${session.id}`,
      note_attributes: [
        { name: "Source", value: "CRM + Stripe" },
        { name: "Stripe Checkout", value: session.id },
      ],
    },
  };

  const resp = await shopifyRest(`/orders.json`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Shopify create order failed: ${resp.status} ${text}`);
  }
  const json = await resp.json();
  const order = json?.order;

  try {
    if (order) await upsertOrderFromShopify(order, process.env.SHOPIFY_SHOP_DOMAIN || "");
  } catch (e) {
    console.warn("CRM upsert warning:", e);
  }

  return order;
}

/**
 * Preferred path for Payment Links / draft-backed sessions:
 *  - Resolve draft id from metadata (session / payment_link / product)
 *  - PUT /draft_orders/{id}/complete.json?payment_pending=true
 *  - GraphQL orderMarkAsPaid(input: ...) to set displayFinancialStatus=PAID
 *  - Annotate and upsert into CRM
 *  - Disable Stripe Payment Link
 */
async function completeDraftAndMarkPaid(session: Stripe.Checkout.Session) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

  let draftId: string | null = (session.metadata?.crmDraftOrderId as string) || null;

  if (!draftId && session.payment_link) {
    try {
      const link = await stripe.paymentLinks.retrieve(String(session.payment_link));
      draftId = (link.metadata?.crmDraftOrderId as string) || null;
    } catch (e) {
      console.warn("PaymentLink retrieve failed:", e);
    }
  }

  if (!draftId) {
    try {
      const full = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["line_items.data.price.product"],
      });
      for (const li of full.line_items?.data || []) {
        const product = li.price?.product as Stripe.Product | undefined;
        const maybe = product?.metadata?.crmDraftOrderId;
        if (maybe) {
          draftId = String(maybe);
          break;
        }
      }
    } catch (e) {
      console.warn("Session expand for draftId failed:", e);
    }
  }

  if (!draftId) return null; // not a draft-backed payment

  const amountTotal = (session.amount_total ?? 0) / 100; // inc VAT (for notes only)
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent as Stripe.PaymentIntent | null)?.id || null;

  // 1) Complete the draft (creates an Order in "pending")
  let shopifyOrderId: number | null = null;
  const completeRes = await shopifyRest(
    `/draft_orders/${draftId}/complete.json?payment_pending=true`,
    { method: "PUT" }
  );

  if (!completeRes.ok) {
    const text = await completeRes.text().catch(() => "");
    // If already completed, try to read order_id from the draft
    try {
      const draftRes = await shopifyRest(`/draft_orders/${draftId}.json`, { method: "GET" });
      if (draftRes.ok) {
        const djson = await draftRes.json().catch(() => null);
        const draft = djson?.draft_order;
        if (draft?.order_id) shopifyOrderId = Number(draft.order_id);
      }
    } catch { /* ignore */ }
    if (!shopifyOrderId) throw new Error(`Draft complete failed: ${completeRes.status} ${text}`);
  } else {
    const completeJson = await completeRes.json().catch(() => null);
    shopifyOrderId = completeJson?.draft_order?.order_id ?? null;
    if (!shopifyOrderId) throw new Error("Draft completed, but no order_id returned");
  }

  // 2) Mark as PAID via GraphQL (correct signature uses `input`)
  const gid = `gid://shopify/Order/${shopifyOrderId}`;
  const result = await shopifyGraphql<{
    orderMarkAsPaid: {
      order: { id: string; displayFinancialStatus: string } | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(
    `
    mutation MarkPaid($input: OrderMarkAsPaidInput!) {
      orderMarkAsPaid(input: $input) {
        order { id displayFinancialStatus }
        userErrors { field message }
      }
    }
  `,
    {
      input: {
        id: gid,
        // Optional extras if you want to store references:
        // transactionReference: paymentIntentId || session.id,
        // paymentGateway: "Stripe",
      },
    }
  );

  const errs = result?.orderMarkAsPaid?.userErrors || [];
  if (errs.length) {
    throw new Error("Shopify GraphQL error: " + JSON.stringify(errs));
  }

  // 3) Annotate (best effort)
  await shopifyRest(`/orders/${shopifyOrderId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      order: {
        id: shopifyOrderId,
        note: `Paid via Stripe Payment Link\nSession: ${session.id}\nPI: ${paymentIntentId || ""}\nGross: £${amountTotal.toFixed(
          2
        )}`,
        note_attributes: [
          { name: "Source", value: "CRM" },
          { name: "Stripe Session", value: session.id },
          { name: "Stripe Payment Intent", value: paymentIntentId || "" },
        ],
      },
    }),
  }).catch(() => {});

  // 4) Mirror into CRM
  const fresh = await shopifyRest(`/orders/${shopifyOrderId}.json`, { method: "GET" });
  if (fresh.ok) {
    const j = await fresh.json().catch(() => null);
    const order = j?.order;
    try {
      if (order) await upsertOrderFromShopify(order, process.env.SHOPIFY_SHOP_DOMAIN || "");
    } catch (e) {
      console.warn("CRM upsert warning:", e);
    }
  }

  // 5) Disable the Payment Link so it can't be re-used
  await disablePaymentLinkIfPresent(session);

  return shopifyOrderId;
}

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const whsec = process.env.STRIPE_WEBHOOK_SECRET || "";
  const sk = process.env.STRIPE_SECRET_KEY || "";

  if (!sig || !whsec || !sk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await req.text();
  let event: Stripe.Event;

  try {
    const stripe = new Stripe(sk, { apiVersion: "2023-10-16" });
    event = stripe.webhooks.constructEvent(raw, sig, whsec);
  } catch (err: any) {
    console.error("Stripe signature verify failed:", err?.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.payment_status === "paid") {
        const completed = await completeDraftAndMarkPaid(s); // draft-backed (Payment Link)
        if (!completed) {
          await createPaidShopifyOrderFromSession(s); // fallback: non-draft “Pay by card”
        }
        await disablePaymentLinkIfPresent(s);
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err: any) {
    console.error("Stripe webhook handler error:", err);
    return NextResponse.json({ error: err?.message || "Webhook error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
