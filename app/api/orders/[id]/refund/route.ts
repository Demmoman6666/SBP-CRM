// app/api/orders/[id]/refund/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";
import { upsertOrderFromShopify } from "@/lib/shopify";

/* Runtime */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------- helpers ---------------- */

function toNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Parse HTML form with inputs named qty_<crmLineItemId> */
function parseQtyForm(form: FormData) {
  const out = new Map<string, number>();
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("qty_")) continue;
    const id = k.slice(4);
    const q = Number(v);
    if (Number.isFinite(q) && q > 0) out.set(id, Math.floor(q));
  }
  return out;
}

/** Find Stripe Checkout Session id (cs_...) recorded on the Shopify order note/attributes */
function extractStripeSessionIdFromShopify(order: any): string | null {
  const note: string = String(order?.note || "");
  const m = note.match(/(cs_(?:test|live)_[A-Za-z0-9]+)/);
  if (m?.[1]) return m[1];
  const attrs: Array<{ name?: string; value?: string }> = order?.note_attributes || [];
  for (const a of attrs) {
    const mm = String(a?.value || "").match(/(cs_(?:test|live)_[A-Za-z0-9]+)/);
    if (mm?.[1]) return mm[1];
  }
  return null;
}

/** Pick a Shopify parent transaction (sale/capture) to attach the refund to */
function pickParentTransactionId(transactions: any[]): string | null {
  if (!Array.isArray(transactions)) return null;
  const candidates = transactions.filter(
    (t) =>
      t &&
      (t.kind === "sale" || t.kind === "capture") &&
      (t.status === "success" || t.status === "completed")
  );
  if (candidates.length === 0) return null;
  const last = candidates[candidates.length - 1];
  return String(last.id);
}

/* ---------------- main handler ---------------- */

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const orderId = ctx.params.id;

    // Accept forms (current UI) and JSON (future)
    let qtyMap = new Map<string, number>();
    let reason: string | undefined;

    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      const json = await req.json().catch(() => ({}));
      const items: Array<{ crmLineItemId: string; quantity: number }> = json?.items || [];
      reason = json?.reason || undefined;
      for (const it of items) {
        const q = Number(it.quantity || 0);
        if (q > 0 && it.crmLineItemId) qtyMap.set(String(it.crmLineItemId), Math.floor(q));
      }
    } else {
      const form = await req.formData();
      qtyMap = parseQtyForm(form);
      const r = form.get("reason");
      reason = r ? String(r) : undefined;
    }

    if (qtyMap.size === 0) {
      return NextResponse.json({ error: "Select at least one item to refund." }, { status: 400 });
    }

    // Load CRM order + lines
    const crmOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { lineItems: true, customer: true },
    });
    if (!crmOrder) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (!crmOrder.shopifyOrderId) {
      return NextResponse.json({ error: "This order is not linked to a Shopify order" }, { status: 400 });
    }

    // Build refund_line_items for Shopify using Shopify line_item_id
    const refund_line_items: Array<{ line_item_id: number; quantity: number; restock_type: string }> = [];
    for (const li of crmOrder.lineItems) {
      const q = qtyMap.get(li.id);
      if (!q) continue;
      const max = Math.max(0, Number(li.quantity || 0));
      if (q > max) {
        const label = li.productTitle || li.variantTitle || li.id;
        return NextResponse.json(
          { error: `Refund qty for line "${label}" exceeds purchased qty.` },
          { status: 400 }
        );
      }
      const shopifyLineItemId = li.shopifyLineItemId ? Number(li.shopifyLineItemId) : NaN;
      if (!Number.isFinite(shopifyLineItemId)) {
        return NextResponse.json({ error: "Missing Shopify line item id on this order line." }, { status: 400 });
      }
      refund_line_items.push({
        line_item_id: shopifyLineItemId,
        quantity: q,
        restock_type: "no_restock",
      });
    }
    if (refund_line_items.length === 0) {
      return NextResponse.json({ error: "Calculated refund is £0.00" }, { status: 400 });
    }

    const shopifyOrderId = crmOrder.shopifyOrderId;

    // 1) Ask Shopify to CALCULATE the refund (VAT/discounts correct)
    const calcRes = await shopifyRest(`/orders/${shopifyOrderId}/refunds/calculate.json`, {
      method: "POST",
      body: JSON.stringify({
        refund: {
          shipping: { full_refund: false },
          refund_line_items,
        },
      }),
    });
    if (!calcRes.ok) {
      const text = await calcRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Shopify calculate failed: ${calcRes.status} ${text}` },
        { status: 502 }
      );
    }
    const calcJson = await calcRes.json();
    const calcRefund = calcJson?.refund || calcJson;

    // Amount to refund (gross)
    let calcAmount = 0;
    const t0 = calcRefund?.transactions?.[0];
    if (t0?.amount != null) {
      calcAmount = Number(t0.amount);
    } else {
      const items: any[] = Array.isArray(calcRefund?.refund_line_items) ? calcRefund.refund_line_items : [];
      const subtotal = items.reduce((s, it) => s + (toNumber(it?.subtotal) || 0), 0);
      const tax = items.reduce((s, it) => s + (toNumber(it?.total_tax) || 0), 0);
      calcAmount = subtotal + tax;
    }
    if (!(calcAmount > 0)) {
      return NextResponse.json({ error: "Calculated refund is £0.00" }, { status: 400 });
    }

    // Fetch Shopify order for currency AND transactions (and possibly a Stripe session)
    const shopOrderRes = await shopifyRest(`/orders/${shopifyOrderId}.json`, { method: "GET" });
    if (!shopOrderRes.ok) {
      const text = await shopOrderRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Fetch Shopify order failed: ${shopOrderRes.status} ${text}` },
        { status: 502 }
      );
    }
    const shopOrderJson = await shopOrderRes.json();
    const shopOrder = shopOrderJson?.order || {};
    const shopCurrency = String(shopOrder?.currency || "GBP").toUpperCase();

    // Load transactions to see if a parent payment exists
    const txRes = await shopifyRest(`/orders/${shopifyOrderId}/transactions.json`, { method: "GET" });
    let parentId: string | null = null;
    if (txRes.ok) {
      const txJson = await txRes.json();
      parentId = pickParentTransactionId(txJson?.transactions || []);
    }

    // Decide Stripe vs Credit Note
    const sessionId = extractStripeSessionIdFromShopify(shopOrder);

    if (sessionId && parentId) {
      // Stripe-backed refund + Shopify refund attached to the parent transaction
      const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
      if (!stripeSecret) {
        return NextResponse.json(
          { error: "Stripe session found on order but STRIPE_SECRET_KEY is not configured." },
          { status: 500 }
        );
      }

      // Refund on Stripe
      const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const pi = session.payment_intent;
      const paymentIntentId =
        typeof pi === "string" ? pi : (pi && "id" in (pi as any) ? (pi as any).id : null);
      if (!paymentIntentId) {
        return NextResponse.json({ error: "Stripe payment intent not found for this order" }, { status: 400 });
      }
      const stripeAmount = Math.round(calcAmount * 100);
      await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: stripeAmount,
        reason: "requested_by_customer",
        metadata: {
          crmOrderId: crmOrder.id,
          shopifyOrderId: String(shopifyOrderId),
          crmReason: reason || "",
        },
      });

      // Create Shopify refund attached to that parent (Shopify infers gateway)
      const createRes = await shopifyRest(`/orders/${shopifyOrderId}/refunds.json`, {
        method: "POST",
        body: JSON.stringify({
          refund: {
            note: reason || undefined,
            notify: true,
            refund_line_items,
            transactions: [
              {
                parent_id: Number(parentId),
                amount: calcAmount.toFixed(2),
                kind: "refund",
                currency: shopCurrency,
              },
            ],
          },
        }),
      });
      if (!createRes.ok) {
        const text = await createRes.text().catch(() => "");
        return NextResponse.json({ error: `Shopify refund create failed: ${createRes.status} ${text}` }, { status: 502 });
      }
    } else {
      // CREDIT NOTE path (no parent payment to attach to)
      const createRes = await shopifyRest(`/orders/${shopifyOrderId}/refunds.json`, {
        method: "POST",
        body: JSON.stringify({
          refund: {
            note: reason || undefined,
            notify: true,
            refund_line_items,
            transactions: [
              {
                amount: calcAmount.toFixed(2),
                kind: "refund",
                gateway: "store-credit", // credit note; no parent_id
                currency: shopCurrency,
              },
            ],
          },
        }),
      });
      if (!createRes.ok) {
        const text = await createRes.text().catch(() => "");
        return NextResponse.json({ error: `Shopify refund create failed: ${createRes.status} ${text}` }, { status: 502 });
      }
    }

    // Refresh CRM copy from Shopify
    try {
      const freshOrderRes = await shopifyRest(`/orders/${shopifyOrderId}.json`, { method: "GET" });
      if (freshOrderRes.ok) {
        const fresh = await freshOrderRes.json();
        if (fresh?.order) await upsertOrderFromShopify(fresh.order, "");
      }
    } catch {
      /* ignore */
    }

    // Redirect back to the order page
    const back = new URL(req.url);
    back.pathname = back.pathname.replace(/\/api\/orders\/[^/]+\/refund$/, `/orders/${crmOrder.id}`);
    back.search = `?refunded=1`;
    return NextResponse.redirect(back, { status: 303 });
  } catch (err: any) {
    console.error("Refund error:", err);
    return NextResponse.json({ error: err?.message || "Refund failed" }, { status: 500 });
  }
}

/** 405 for GET */
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
