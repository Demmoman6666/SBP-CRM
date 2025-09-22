// app/api/orders/[orderId]/refund/route.ts
import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefundReq = {
  lineItemId?: number;   // Shopify line_item.id to refund (optional if doing full refund)
  quantity?: number;     // how many units to refund
  note?: string;         // reason / note
};

export async function POST(
  req: Request,
  { params }: { params: { orderId: string } }
) {
  try {
    const orderIdNum = Number(params.orderId);
    if (!Number.isFinite(orderIdNum)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as RefundReq;

    // 1) Load the order so we can branch by payment method
    const get = await shopifyRest(`/orders/${orderIdNum}.json`, { method: "GET" });
    if (!get.ok) {
      const t = await get.text().catch(() => "");
      return NextResponse.json({ error: `Load order failed: ${get.status} ${t}` }, { status: 400 });
    }
    const order = (await get.json())?.order as any;
    if (!order?.id) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Pull machine markers we add during creation/complete
    const attrsArr: Array<{ name?: string; value?: string }> = Array.isArray(order.note_attributes)
      ? order.note_attributes
      : [];

    const attrs = new Map<string, string>();
    for (const n of attrsArr) {
      const k = (n?.name || "").toString();
      if (k) attrs.set(k, (n?.value || "").toString());
    }
    const method = (attrs.get("crm_payment_method") || "").toLowerCase();

    // 2) If this is an account order, refund via Shopify only (no Stripe)
    if (method === "account") {
      // Build a "calculate" payload
      const refund_line_items: any[] = [];

      if (body.lineItemId && body.quantity) {
        refund_line_items.push({
          line_item_id: Number(body.lineItemId),
          quantity: Number(body.quantity),
          restock_type: "no_restock", // or "cancel" / "return" depending on your policy
        });
      } else {
        // No specific line => fall back to refunding everything that isn't refunded yet
        for (const li of order.line_items || []) {
          const refundable = Number(li.quantity) - Number(li.fulfillable_quantity || 0) < Number(li.quantity)
            ? Number(li.quantity) // simple default; adjust to your policy
            : Number(li.quantity);
          if (refundable > 0) {
            refund_line_items.push({
              line_item_id: li.id,
              quantity: refundable,
              restock_type: "no_restock",
            });
          }
        }
      }

      // Calculate the refund (Shopify figures amounts/tax)
      const calc = await shopifyRest(`/orders/${orderIdNum}/refunds/calculate.json`, {
        method: "POST",
        body: JSON.stringify({
          refund: {
            currency: order.currency || "GBP",
            shipping: undefined, // add if you need to refund shipping
            refund_line_items,
            note: body.note || "Refund created from SBP CRM (account)",
          },
        }),
      });
      if (!calc.ok) {
        const t = await calc.text().catch(() => "");
        return NextResponse.json({ error: `Refund calculate failed: ${calc.status} ${t}` }, { status: 400 });
      }
      const calcJson = await calc.json().catch(() => ({}));
      const calculatedRefund = calcJson?.refund ?? null;
      if (!calculatedRefund) {
        return NextResponse.json({ error: "Refund calculation returned no data" }, { status: 500 });
      }

      // Create the refund (no transactions for on-account; it's just an accounting/stock action)
      const create = await shopifyRest(`/orders/${orderIdNum}/refunds.json`, {
        method: "POST",
        body: JSON.stringify({
          refund: {
            ...calculatedRefund,
            transactions: [], // no gateway transaction for account terms
            notify: false,
            note: body.note || "Refund created from SBP CRM (account)",
          },
        }),
      });

      if (!create.ok) {
        const t = await create.text().catch(() => "");
        return NextResponse.json({ error: `Refund create failed: ${create.status} ${t}` }, { status: 400 });
      }
      const created = await create.json().catch(() => ({}));
      return NextResponse.json({ ok: true, refund: created?.refund ?? null }, { status: 200 });
    }

    // 3) Otherwise, this is NOT an account order ⇒ your existing Stripe flow applies
    // If you store a Stripe Checkout Session id in note_attributes (recommended),
    // you can fetch it like this:
    const stripeSessionId =
      attrs.get("stripe_checkout_session") ||
      attrs.get("stripe_cs_id") ||
      "";

    if (!stripeSessionId) {
      // Keep your current error semantics if you prefer:
      return NextResponse.json(
        { error: "Could not determine original Stripe Checkout Session from Shopify order note." },
        { status: 400 }
      );
    }

    // TODO: perform your Stripe refund using stripeSessionId, then optionally also create a Shopify refund.
    // Leaving this as-is to avoid changing your payments logic.

    return NextResponse.json(
      { error: "Stripe refund branch not implemented in this example." },
      { status: 400 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
