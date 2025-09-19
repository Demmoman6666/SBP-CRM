// app/api/webhooks/stripe/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyRest, upsertOrderFromShopify } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 20% by default — override with VAT_RATE in your env if needed
const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

/** helpers */
function toMoney(n: number) {
  return Number(n.toFixed(2)); // Shopify accepts number or string; keep 2dp
}
function upper(s?: string | null) {
  return (s || "").toUpperCase();
}

/** After first successful payment, disable the Payment Link to prevent re-use (double-pay) */
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

/**
 * Fallback path (your existing “Pay by card” flow):
 * Creates a *new* paid Shopify order directly from the Checkout Session (no draft involved).
 * Sends ex-VAT unit prices + explicit tax_lines so VAT displays on the order.
 */
async function createPaidShopifyOrderFromSession(session: Stripe.Checkout.Session) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

  const crmCustomerId = String(session.metadata?.crmCustomerId || "");
  const shopifyCustomerId = String(session.metadata?.shopifyCustomerId || "");
  if (!crmCustomerId || !shopifyCustomerId) throw new Error("Missing customer ids in session metadata");

  // Expand to read product metadata (variantId)
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
 *  - **PUT** draft_orders/{id}/complete.json?payment_pending=true  ✅
 *  - Post a successful sale transaction to mark the order paid
 *  - Annotate and upsert into CRM
 *  - Deactivate the Payment Link
 */
async function completeDraftAndMarkPaid(session: Stripe.Checkout.Session) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

  let draftId: string | null = (session.metadata?.crmDraftOrderId as string) || null;

  // Try Payment Link metadata
  if (!draftId && session.payment_link) {
    try {
      const link = await stripe.paymentLinks.retrieve(String(session.payment_link));
      draftId = (link.metadata?.crmDraftOrderId as string) || null;
    } catch (e) {
      console.warn("PaymentLink retrieve failed:", e);
    }
  }

  // Fallback: expand line items, look for product.metadata.crmDraftOrderId
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

  const amountTotal = (session.amount_total ?? 0) / 100; // inc VAT (gross)
  const currency = upper(session.currency) || "GBP";
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent as Stripe.PaymentIntent | null)?.id || null;

  // **Fix**: Complete the draft with PUT (POST returns 406)
  let shopifyOrderId: number | null = null;

  const completeRes = await shopifyRest(
    `/draft_orders/${draftId}/complete.json?payment_pending=true`,
    { method: "PUT" } // ← important
  );

  if (!completeRes.ok) {
    const text = await completeRes.text().catch(() => "");
    // If Shopify already completed it (e.g., retry), fetch the draft to see if an order exists
    try {
      const draftRes = await shopifyRest(`/draft_orders/${draftId}.json`, { method: "GET" });
      if (draftRes.ok) {
        const djson = await draftRes.json().catch(() => null);
        const draft = djson?.draft_order;
        // Some API versions include order_id after completion; try to use it
        if (draft?.order_id) {
          shopifyOrderId = Number(draft.order_id);
        }
      }
    } catch {
      /* ignore */
    }
    if (!shopifyOrderId) {
      throw new Error(`Draft complete failed: ${completeRes.status} ${text}`);
    }
  } else {
    const completeJson = await completeRes.json().catch(() => null);
    shopifyOrderId = completeJson?.draft_order?.order_id ?? null;
    if (!shopifyOrderId) throw new Error("Draft completed, but no order_id returned");
  }

  // Post a successful transaction to mark the order PAID
  const txnRes = await shopifyRest(`/orders/${shopifyOrderId}/transactions.json`, {
    method: "POST",
    body: JSON.stringify({
      transaction: {
        kind: "sale",
        status: "success",
        amount: toMoney(amountTotal),
        currency,
        gateway: "stripe",
        authorization: paymentIntentId || undefined,
        message: `Stripe Checkout session ${session.id}`,
      },
    }),
  });
  if (!txnRes.ok) {
    const t = await txnRes.text().catch(() => "");
    throw new Error(`Shopify transaction create failed: ${txnRes.status} ${t}`);
  }

  // Annotate the order (best effort)
  await shopifyRest(`/orders/${shopifyOrderId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      order: {
        id: shopifyOrderId,
        note: `Paid via Stripe Payment Link\nSession: ${session.id}\nPI: ${paymentIntentId || ""}`,
        note_attributes: [
          { name: "Source", value: "CRM" },
          { name: "Stripe Session", value: session.id },
          { name: "Stripe Payment Intent", value: paymentIntentId || "" },
        ],
      },
    }),
  }).catch(() => {});

  // Upsert into CRM
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

  // Disable the Payment Link so it can't be re-used
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
    // Handle both immediate and async confirmation flows
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
        await disablePaymentLinkIfPresent(s); // double-safety
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err: any) {
    console.error("Stripe webhook handler error:", err);
    return NextResponse.json({ error: err?.message || "Webhook error" }, { status: 500 });
  }
}

// Optional hard 405 for other verbs
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
