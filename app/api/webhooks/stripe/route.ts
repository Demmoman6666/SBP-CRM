// app/api/webhooks/stripe/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
  if (!signingSecret || !stripeSecret) {
    return NextResponse.json({ error: "Missing Stripe env vars" }, { status: 500 });
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

  // Stripe requires the raw body to verify signatures
  const sig = req.headers.get("stripe-signature") || "";
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, signingSecret);
  } catch (err: any) {
    console.error("Stripe signature verification failed:", err?.message);
    return NextResponse.json({ error: `Signature verification failed: ${err?.message}` }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    try {
      // Get full line items + expanded product to read back our variantId metadata
      const session = await stripe.checkout.sessions.retrieve(
        (event.data.object as Stripe.Checkout.Session).id,
        { expand: ["line_items.data.price.product"] }
      );

      const shopifyCustomerId = session.metadata?.shopifyCustomerId || "";
      const currency = (session.currency || "gbp").toUpperCase();
      const amountTotal = (session.amount_total || 0) / 100;

      const items = (session.line_items?.data || []).map((li) => {
        const product = li.price?.product as Stripe.Product | null;
        const variantId = product && (product as any).metadata?.variantId;
        const quantity = li.quantity || 1;
        return { variantId, quantity };
      }).filter((x) => x.variantId);

      if (!items.length) {
        console.error("No items with variantId metadata; cannot make Shopify order.");
        return NextResponse.json({ ok: true }); // acknowledge so Stripe stops retrying
      }

      // Build Shopify order payload, mark as PAID via a transaction
      const line_items = items.map((it) => ({
        variant_id: Number(it.variantId),
        quantity: Number(it.quantity),
      }));

      const payload: any = {
        order: {
          customer: shopifyCustomerId ? { id: Number(shopifyCustomerId) } : undefined,
          currency,
          line_items,
          // Mark paid
          financial_status: "paid",
          transactions: [
            {
              kind: "sale",
              status: "success",
              amount: amountTotal.toFixed(2),
              gateway: "stripe",
              source_name: "web",
            },
          ],
          // Keep these as a single comma-separated string (Shopify expects string here)
          tags: "CRM,Stripe",
          note: `Stripe Checkout ${session.id}`,
          send_receipt: false,
          send_fulfillment_receipt: false,
        },
      };

      const resp = await shopifyRest(`/orders.json`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error("Shopify order create failed:", resp.status, text);
        return NextResponse.json({ error: `Shopify order create failed: ${resp.status}` }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error("Webhook handler error:", err);
      return NextResponse.json({ error: err?.message || "Webhook failed" }, { status: 500 });
    }
  }

  // Ignore other events (but acknowledge)
  return NextResponse.json({ received: true });
}
