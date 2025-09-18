import { NextResponse } from "next/server";
import Stripe from "stripe";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// We need the raw body for Stripe signature verification
export async function POST(req: Request) {
  const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!stripeSecret || !webhookSecret) {
    return NextResponse.json({ error: "Missing Stripe env vars" }, { status: 500 });
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

  const sig = req.headers.get("stripe-signature") || "";
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error("Stripe webhook signature verification failed:", err?.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // Pull Shopify customer id from session metadata
    const shopifyCustomerId = session.metadata?.shopifyCustomerId;
    if (!shopifyCustomerId) {
      console.warn("Stripe session missing shopifyCustomerId metadata; skipping Shopify order creation.");
      return NextResponse.json({ ok: true });
    }

    // Get line items (+ expand price.product to read our variantId metadata)
    const li = await stripe.checkout.sessions.listLineItems(session.id, {
      expand: ["data.price.product", "data.price"],
      limit: 100,
    });

    const line_items = li.data
      .map((item) => {
        const price = item.price!;
        // Prefer product metadata; fallback to price metadata
        const productObj = price.product as Stripe.Product | null;
        const variantId =
          (productObj?.metadata?.variantId as string | undefined) ||
          (price.metadata?.variantId as string | undefined) ||
          undefined;

        if (!variantId) return null;

        return {
          variant_id: Number(variantId),
          quantity: item.quantity || 1,
        };
      })
      .filter(Boolean) as Array<{ variant_id: number; quantity: number }>;

    if (line_items.length === 0) {
      console.warn("Stripe session has no mappable line items; skipping Shopify order creation.");
      return NextResponse.json({ ok: true });
    }

    // Create a *paid* Shopify Order (unfulfilled)
    const payload = {
      order: {
        customer: { id: Number(shopifyCustomerId) },
        line_items,
        financial_status: "paid", // mark as paid
        tags: "CRM,Stripe",
        note: `Stripe Checkout ${session.id}`,
      },
    };

    const resp = await shopifyRest(`/orders.json`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error("Shopify order create failed:", resp.status, text);
      return NextResponse.json(
        { error: `Shopify order create failed: ${resp.status}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  }

  // Ignore other events
  return NextResponse.json({ received: true });
}
