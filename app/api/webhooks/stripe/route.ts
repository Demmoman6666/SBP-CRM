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

/**
 * Fallback path (your existing logic):
 * Create a *new* paid Shopify order from a Checkout Session (no draft involved).
 * Sends ex-VAT unit prices + explicit tax_lines so VAT displays on the order.
 */
async function createPaidShopifyOrderFromSession(session: Stripe.Checkout.Session) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

  const crmCustomerId = String(session.metadata?.crmCustomerId || "");
  const shopifyCustomerId = String(session.metadata?.shopifyCustomerId || "");
  if (!crmCustomerId || !shopifyCustomerId) throw new Error("Missing customer ids in session metadata");

  // Expand line items so we can access product metadata (variantId added at checkout creation)
  const full = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items.data.price.product"],
  });

  const currency = upper(full.currency) || "GBP";

  type ShopifyLine = {
    variant_id: number;
    quantity: number;
    price: number; // unit ex VAT
    taxable?: boolean;
    tax_lines: Array<{ title: string; rate: number; price: number }>; // line tax (amount)
  };

  const shopifyLines: ShopifyLine[] = [];
  let totalTax = 0;

  for (const li of full.line_items?.data || []) {
    const qty = Number(li.quantity || 1);

    // We charged inc-VAT in Stripe. Convert back to ex-VAT for Shopify and send explicit tax_lines.
    const unitInc =
      li.amount_total && qty > 0
        ? (li.amount_total / 100) / qty
        : (li.price?.unit_amount ?? 0) / 100;

    const unitEx = unitInc / (1 + VAT_RATE);
    const lineEx = unitEx * qty;
    const lineTax = lineEx * VAT_RATE;

    // variantId came from product metadata we set when creating the Checkout Session
    let variantId: string | undefined;
    if (li.price && typeof li.price.product === "object") {
      variantId = (li.price.product as Stripe.Product).metadata?.variantId;
    }
    if (!variantId) throw new Error("Missing variantId on Stripe product metadata");

    shopifyLines.push({
      variant_id: Number(variantId),
      quantity: qty,
      price: toMoney(unitEx), // unit price EX VAT
      taxable: true,
      tax_lines: [
        { title: "VAT", rate: VAT_RATE, price: toMoney(lineTax) }, // tax amount for this line
      ],
    });

    totalTax += lineTax;
  }

  // Build Shopify order payload: taxes_included:false + explicit tax_lines so VAT shows on the order
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

  const resp = await shopifyRest(`/orders.json`, { method: "POST", body: JSON.stringify(payload) });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Shopify create order failed: ${resp.status} ${text}`);
  }
  const json = await resp.json();
  const order = json?.order;

  // Mirror into CRM for the "Recent Orders" view
  try {
    if (order) await upsertOrderFromShopify(order, process.env.SHOPIFY_SHOP_DOMAIN || "");
  } catch (e) {
    console.warn("CRM upsert warning:", e);
  }

  return order;
}

/**
 * Preferred path for Payment Links (and any session that references a draft):
 *  - Find draft id from session.metadata.crmDraftOrderId or the Payment Link metadata
 *  - Complete the draft (payment_pending=true) to create a Shopify order
 *  - Post a successful transaction (so order becomes paid)
 *  - Update note and upsert into CRM
 */
async function completeDraftAndMarkPaid(session: Stripe.Checkout.Session) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

  let draftId: string | null = (session.metadata?.crmDraftOrderId as string) || null;

  // If it was created via Payment Link, pull metadata from the link too
  if (!draftId && session.payment_link) {
    try {
      const link = await stripe.paymentLinks.retrieve(String(session.payment_link));
      draftId = (link.metadata?.crmDraftOrderId as string) || null;
    } catch {
      // ignore
    }
  }
  if (!draftId) return null; // not a draft-backed payment

  const amountTotal = (session.amount_total ?? 0) / 100; // inc VAT
  const currency = upper(session.currency) || "GBP";
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent as Stripe.PaymentIntent | null)?.id || null;

  // 1) Complete the draft -> creates a Shopify order with payment pending
  const completeRes = await shopifyRest(
    `/draft_orders/${draftId}/complete.json?payment_pending=true`,
    { method: "POST" }
  );
  const completeText = await completeRes.text().catch(() => "");
  if (!completeRes.ok) {
    throw new Error(`Draft complete failed: ${completeRes.status} ${completeText}`);
  }
  const completeJson = JSON.parse(completeText);
  const shopifyOrderId: number | null = completeJson?.draft_order?.order_id ?? null;
  if (!shopifyOrderId) throw new Error("Draft completed, but no order_id returned");

  // 2) Post a successful transaction to mark the order paid
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

  // 3) Optional: annotate the order
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

  // 4) Fetch the created order and upsert into CRM
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
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.payment_status === "paid") {
        // Prefer the draft flow (Payment Link / draft-backed sessions)
        const completed = await completeDraftAndMarkPaid(s);
        if (!completed) {
          // Fallback: create a new paid order from the session (older “Pay by card” flow)
          await createPaidShopifyOrderFromSession(s);
        }
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
