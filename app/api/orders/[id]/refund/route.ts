// app/api/orders/[id]/refund/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

// Helpers
function toNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function parseQtyForm(form: FormData) {
  // expects keys like qty_<orderLineItemId>
  const out = new Map<string, number>();
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("qty_")) continue;
    const id = k.slice(4);
    const q = Number(v);
    if (Number.isFinite(q) && q > 0) out.set(id, Math.floor(q));
  }
  return out;
}
function extractStripeSessionIdFromShopify(order: any): string | null {
  const note: string = order?.note || "";
  // try the note first
  const m = note.match(/(cs_(?:test|live)_[A-Za-z0-9]+)/);
  if (m?.[1]) return m[1];

  // then note_attributes
  const attrs: Array<{ name?: string; value?: string }> = order?.note_attributes || [];
  for (const a of attrs) {
    const val = String(a?.value || "");
    const mm = val.match(/(cs_(?:test|live)_[A-Za-z0-9]+)/);
    if (mm?.[1]) return mm[1];
  }
  return null;
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
    if (!stripeSecret) {
      return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY env var" }, { status: 500 });
    }
    const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

    const orderId = ctx.params.id;
    const form = await req.formData();
    const qtyMap = parseQtyForm(form);
    const reason = String(form.get("reason") || "") || undefined;

    if (qtyMap.size === 0) {
      return NextResponse.json({ error: "Select at least one item to refund." }, { status: 400 });
    }

    // Load CRM order + lines
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { lineItems: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Sum refund (gross, inc VAT). Your stored lineItems.price is unit ex-VAT.
    let net = 0;
    for (const li of order.lineItems) {
      const q = qtyMap.get(li.id);
      if (!q) continue;
      const max = Math.max(0, Number(li.quantity || 0));
      if (q > max) {
        return NextResponse.json({ error: `Refund qty for line ${li.id} exceeds purchased qty.` }, { status: 400 });
      }
      const unit = toNumber(li.price) ?? 0;
      net += unit * q;
    }
    if (net <= 0) {
      return NextResponse.json({ error: "Calculated refund is £0.00" }, { status: 400 });
    }
    const gross = net * (1 + VAT_RATE);
    const amount = Math.round(gross * 100); // pence

    // We created the Shopify order after Stripe checkout; pull the Checkout Session id from Shopify order
    // (we put "Stripe Checkout <cs_...>" in the order note in the webhook).
    let stripePaymentIntentId: string | null = null;

    if (order.shopifyOrderId) {
      const resp = await shopifyRest(`/orders/${order.shopifyOrderId}.json`, { method: "GET" });
      if (resp.ok) {
        const sj = await resp.json();
        const sessionId = extractStripeSessionIdFromShopify(sj?.order);
        if (sessionId) {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          const pi = session.payment_intent;
          if (typeof pi === "string") stripePaymentIntentId = pi;
          else if (pi && "id" in (pi as any)) stripePaymentIntentId = (pi as any).id;
        }
      }
    }

    if (!stripePaymentIntentId) {
      return NextResponse.json(
        { error: "Could not determine original Stripe payment. Ensure the Shopify order note contains the Checkout Session id (cs_...)."},
        { status: 400 }
      );
    }

    // Create a partial refund on Stripe
    await stripe.refunds.create({
      payment_intent: stripePaymentIntentId,
      amount,
      reason: "requested_by_customer",
      metadata: {
        crmOrderId: order.id,
        shopifyOrderId: order.shopifyOrderId || "",
        crmReason: reason || "",
      },
    });

    // (Optional) You could also create a Shopify refund record here using the Shopify Refund API.
    // For now we just redirect back to the order page with a flag.
    const redirectTo = new URL(`${req.url.split("/api/")[0]}/orders/${order.id}?refunded=1&amount=${amount}`);
    return NextResponse.redirect(redirectTo, { status: 303 });
  } catch (err: any) {
    console.error("Refund error:", err);
    return NextResponse.json({ error: err?.message || "Refund failed" }, { status: 500 });
  }
}

// (Optional) 405 for other verbs
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
