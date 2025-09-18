// app/api/orders/[id]/refund/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ───────────────────── helpers ───────────────────── */
function toNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Parse HTML form with inputs named qty_<crmLineItemId> and an optional "reason" */
async function readRefundRequest(
  req: Request,
  validIds: string[]
): Promise<{ reason?: string; items: Array<{ lineId: string; quantity: number }> }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const json = (await req.json()) ?? {};
    const itemsRaw = Array.isArray(json.items) ? json.items : [];
    const items = itemsRaw
      .map((i: any) => ({ lineId: String(i.lineId), quantity: Number(i.quantity || 0) }))
      .filter((i) => i.quantity > 0 && validIds.includes(i.lineId));
    return { reason: json.reason ? String(json.reason) : undefined, items };
  }

  const fd = await req.formData();
  const items: Array<{ lineId: string; quantity: number }> = [];
  for (const id of validIds) {
    const key = `qty_${id}`;
    const q = Number(fd.get(key) ?? 0);
    if (Number.isFinite(q) && q > 0) items.push({ lineId: id, quantity: Math.floor(q) });
  }
  const reason = String(fd.get("reason") || "") || undefined;
  return { reason, items };
}

/** Extract a Stripe Checkout Session id (cs_...) from a Shopify order's note or note_attributes */
function extractStripeSessionIdFromShopify(order: any): string | null {
  const note: string = order?.note || "";
  let m = note.match(/(cs_(?:test|live)_[A-Za-z0-9]+)/);
  if (m?.[1]) return m[1];

  const attrs: Array<{ name?: string; value?: string }> = order?.note_attributes || [];
  for (const a of attrs) {
    const val = String(a?.value || "");
    m = val.match(/(cs_(?:test|live)_[A-Za-z0-9]+)/);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Convert a decimal string like "12.34" to integer pence/cents (rounding). */
function decimalToMinorUnits(amount: string | number): number {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return Math.round(Number.isFinite(n) ? n * 100 : 0);
}

/** ───────────────────── handler ───────────────────── */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
    if (!stripeSecret) {
      return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY env var" }, { status: 500 });
    }
    const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

    // 1) Load CRM order + line items
    const crmOrder = await prisma.order.findUnique({
      where: { id: params.id },
      include: { lineItems: true },
    });
    if (!crmOrder) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (!crmOrder.shopifyOrderId) {
      return NextResponse.json({ error: "This order is not linked to Shopify" }, { status: 400 });
    }

    // 2) Read requested refund quantities
    const validIds = crmOrder.lineItems.map((l) => l.id);
    const { reason, items } = await readRefundRequest(req, validIds);
    if (!items.length) {
      return NextResponse.json({ error: "Select at least one item to refund." }, { status: 400 });
    }

    // Clamp quantities to purchased amounts and map to Shopify line_item_id
    const byId = new Map(crmOrder.lineItems.map((l) => [l.id, l]));
    const refund_line_items = items.map((i) => {
      const li = byId.get(i.lineId);
      if (!li?.shopifyLineItemId) {
        throw new Error(`Missing Shopify line_item_id for CRM line ${i.lineId}`);
      }
      const maxQty = Math.max(0, Number(li.quantity || 0));
      const qty = Math.min(i.quantity, maxQty);
      return {
        line_item_id: Number(li.shopifyLineItemId),
        quantity: qty,
        restock_type: "no_restock" as const, // change to "return" if inventory should be returned
      };
    });

    const shopifyOrderId = Number(crmOrder.shopifyOrderId);

    // 3) Get original sale/capture transaction to link the refund against
    const txRes = await shopifyRest(`/orders/${shopifyOrderId}/transactions.json`, { method: "GET" });
    if (!txRes.ok) {
      const t = await txRes.text().catch(() => "");
      throw new Error(`Fetch transactions failed: ${txRes.status} ${t}`);
    }
    const txJson: any = await txRes.json();
    const saleTx =
      (txJson?.transactions || []).find((t: any) => t.kind === "sale" || t.kind === "capture") || null;

    // 4) Ask Shopify to CALCULATE the refund (Shopify computes line, shipping, tax/VAT)
    const calcRes = await shopifyRest(`/orders/${shopifyOrderId}/refunds/calculate.json`, {
      method: "POST",
      body: JSON.stringify({
        refund: {
          currency: crmOrder.currency || "GBP",
          note: reason || undefined,
          shipping: { amount: "0.00" },
          refund_line_items,
          transactions: saleTx ? [{ parent_id: Number(saleTx.id) }] : undefined,
        },
      }),
    });
    if (!calcRes.ok) {
      const t = await calcRes.text().catch(() => "");
      return NextResponse.json({ error: `Refund calculate failed: ${calcRes.status} ${t}` }, { status: 502 });
    }
    const calcJson: any = await calcRes.json();

    // Extract the total refund amount from Shopify's calculation (decimal major units)
    const calcAmountStr =
      calcJson?.refund?.transactions?.[0]?.amount ??
      calcJson?.refund?.amount ??
      "0.00";
    const refundMinorUnits = decimalToMinorUnits(calcAmountStr);
    if (refundMinorUnits <= 0) {
      return NextResponse.json({ error: "Calculated refund is £0.00" }, { status: 400 });
    }

    // 5) Find the Stripe PaymentIntent (from the Shopify order's stored Checkout Session id)
    let stripePaymentIntentId: string | null = null;
    // Fetch Shopify order to read its note/note_attributes for cs_...
    const orderRes = await shopifyRest(`/orders/${shopifyOrderId}.json`, { method: "GET" });
    if (orderRes.ok) {
      const orderJson = await orderRes.json();
      const sessionId = extractStripeSessionIdFromShopify(orderJson?.order);
      if (sessionId) {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const pi = session.payment_intent;
        if (typeof pi === "string") stripePaymentIntentId = pi;
        else if (pi && "id" in (pi as any)) stripePaymentIntentId = (pi as any).id;
      }
    }
    if (!stripePaymentIntentId) {
      return NextResponse.json(
        { error: "Could not determine original Stripe payment (no Checkout Session id found)." },
        { status: 400 }
      );
    }

    // 6) Perform the Stripe refund for the exact amount Shopify calculated
    await stripe.refunds.create({
      payment_intent: stripePaymentIntentId,
      amount: refundMinorUnits, // already includes VAT because we used Shopify's calc
      reason: "requested_by_customer",
      metadata: {
        crmOrderId: crmOrder.id,
        shopifyOrderId: crmOrder.shopifyOrderId || "",
        crmReason: reason || "",
      },
    });

    // 7) Create the Shopify refund (so Shopify shows "refunded/partially_refunded")
    const createRes = await shopifyRest(`/orders/${shopifyOrderId}/refunds.json`, {
      method: "POST",
      body: JSON.stringify({
        refund: {
          ...calcJson.refund,
          note: reason || undefined,
          // Ensure the refund is linked to the original sale transaction
          transactions: saleTx
            ? [
                {
                  parent_id: Number(saleTx.id),
                  amount: calcAmountStr,
                  kind: "refund",
                },
              ]
            : calcJson.refund?.transactions,
          notify: true, // email customer
        },
      }),
    });

    const text = await createRes.text();
    if (!createRes.ok) {
      return NextResponse.json(
        { error: `Shopify refund create failed: ${createRes.status} ${text}` },
        { status: 502 }
      );
    }

    // Redirect back to the order page
    const base = req.url.split("/api/")[0];
    return NextResponse.redirect(`${base}/orders/${crmOrder.id}?refunded=1`, { status: 303 });
  } catch (err: any) {
    console.error("Refund error:", err);
    return NextResponse.json({ error: err?.message || "Refund failed" }, { status: 500 });
  }
}

/** Disallow GET (avoids the 405 page if someone browses to this endpoint) */
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
