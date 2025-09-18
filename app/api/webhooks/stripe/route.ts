// app/api/webhooks/stripe/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { shopifyRest, upsertOrderFromShopify } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
  if (!signingSecret || !stripeSecret) {
    return NextResponse.json({ error: "Missing STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY" }, { status: 500 });
  }

  // Pin the SDK version (parsing doesn’t need to match your endpoint’s version)
  const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

  // Stripe signature verification requires the RAW body
  const sig = req.headers.get("stripe-signature") || "";
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, signingSecret);
  } catch (err: any) {
    console.error("[stripe:webhook] signature verify failed:", err?.message);
    return NextResponse.json({ error: `Signature verification failed: ${err?.message}` }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    try {
      const session = event.data.object as Stripe.Checkout.Session;

      // IMPORTANT: fetch line items separately and expand the product to read our metadata.variantId
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 100,
        expand: ["data.price.product"],
      });

      const items = lineItems.data
        .map((li) => {
          const product = li.price?.product as Stripe.Product | null;
          const variantId = product && (product as any).metadata?.variantId;
          const quantity = li.quantity || 1;
          return variantId ? { variantId, quantity } : null;
        })
        .filter(Boolean) as Array<{ variantId: string; quantity: number }>;

      if (!items.length) {
        console.error("[stripe:webhook] No items carried variantId metadata; cannot create Shopify order.");
        return NextResponse.json({ ok: true }); // acknowledge so Stripe stops retrying
      }

      const shopifyCustomerId = session.metadata?.shopifyCustomerId || "";
      const currency = (session.currency || "gbp").toUpperCase();
      const amountTotal = (session.amount_total || 0) / 100;

      const line_items = items.map((it) => ({
        variant_id: Number(it.variantId),
        quantity: Number(it.quantity),
      }));

      const payload: any = {
        order: {
          customer: shopifyCustomerId ? { id: Number(shopifyCustomerId) } : undefined,
          currency,
          line_items,
          // mark as PAID and add a sale transaction
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
          // keep tags as a comma-separated STRING (Shopify expects string here)
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
        console.error("[shopify] order create failed:", resp.status, text);
        return NextResponse.json({ error: `Shopify order create failed: ${resp.status}` }, { status: 500 });
      }

      // Parse safely (in case body is empty) and upsert into your CRM so “Recent orders” updates immediately
      let created: any = null;
      try {
        created = await resp.json();
      } catch {
        created = null;
      }

      const orderObj = created?.order || null;
      if (orderObj) {
        try {
          await upsertOrderFromShopify(orderObj, process.env.SHOPIFY_SHOP_DOMAIN || "");
        } catch (e) {
          console.warn("[crm] upsertOrderFromShopify failed (non-fatal):", (e as any)?.message);
        }
      }

      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error("[stripe:webhook] handler error:", err);
      return NextResponse.json({ error: err?.message || "Webhook failed" }, { status: 500 });
    }
  }

  // Acknowledge all other events
  return NextResponse.json({ received: true });
}
