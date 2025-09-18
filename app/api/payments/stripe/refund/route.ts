// app/api/payments/stripe/refund/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefundLine = {
  id?: string;
  sku?: string | null;
  productTitle?: string | null;
  variantTitle?: string | null;
  unitGross: number;   // £ inc VAT
  quantity: number;
};

type PostBody = {
  orderId: string;
  shopifyOrderId?: string | null;
  // optional escape hatches
  paymentIntentId?: string | null;
  sessionId?: string | null;
  lines: RefundLine[];
};

function poundsToPence(n: number) {
  return Math.max(0, Math.round(n * 100));
}

async function resolvePaymentIntentId(
  stripe: Stripe,
  input: { paymentIntentId?: string | null; sessionId?: string | null; shopifyOrderId?: string | null }
): Promise<string> {
  // 1) Direct
  if (input.paymentIntentId) return input.paymentIntentId;

  // 2) From Checkout Session
  if (input.sessionId) {
    const sess = await stripe.checkout.sessions.retrieve(input.sessionId);
    if (!sess?.payment_intent) throw new Error("Stripe session has no payment_intent");
    const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent.id;
    return pi;
  }

  // 3) From Shopify note_attributes on the order
  if (input.shopifyOrderId) {
    const res = await shopifyRest(`/orders/${input.shopifyOrderId}.json`, { method: "GET" });
    const json = await res.json().catch(() => ({}));
    const attrs: Array<{ name?: string; value?: string }> = json?.order?.note_attributes || [];
    const hit =
      attrs.find(a => (a.name || "").toLowerCase() === "stripepaymentintent") ||
      attrs.find(a => (a.name || "").toLowerCase() === "stripe_payment_intent_id");
    const val = hit?.value?.trim();
    if (val) return val;
  }

  throw new Error("Could not resolve Stripe payment intent for this order");
}

export async function POST(req: Request) {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
    if (!stripeSecret) {
      return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });
    }
    // Pin version for typing stability
    const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

    const body = (await req.json()) as PostBody;
    if (!body?.orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: "lines are required" }, { status: 400 });
    }

    // Compute total £ inc VAT (then convert to pence)
    const totalGross = body.lines.reduce((sum, l) => {
      const q = Number(l.quantity || 0);
      const u = Number(l.unitGross || 0);
      if (q < 0 || u < 0) return sum;
      return sum + q * u;
    }, 0);
    const amount = poundsToPence(totalGross);
    if (amount <= 0) {
      return NextResponse.json({ error: "Refund amount must be greater than 0" }, { status: 400 });
    }

    // Resolve PI
    const paymentIntentId = await resolvePaymentIntentId(stripe, {
      paymentIntentId: body.paymentIntentId || null,
      sessionId: body.sessionId || null,
      shopifyOrderId: body.shopifyOrderId || null,
    });

    // Create Stripe refund
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount,
      reason: "requested_by_customer",
      metadata: {
        source: "SBP-CRM",
        crmOrderId: body.orderId,
        shopifyOrderId: body.shopifyOrderId || "",
      },
    });

    return NextResponse.json({ ok: true, refund }, { status: 200 });
  } catch (err: any) {
    console.error("Stripe refund error:", err);
    return NextResponse.json({ error: err?.message || "Refund failed" }, { status: 500 });
  }
}
