import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  items: Array<{ line_item_id: number; quantity: number }>;
};

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const orderId = ctx.params.id;
    const body = (await req.json()) as Body;

    if (!Array.isArray(body?.items) || body.items.length === 0) {
      return NextResponse.json({ amount: 0 }, { status: 200 });
    }

    const crmOrder = await prisma.order.findUnique({ where: { id: orderId } });
    if (!crmOrder?.shopifyOrderId) {
      return NextResponse.json({ error: "Order not linked to Shopify" }, { status: 400 });
    }

    // Ask Shopify to calculate totals (VAT/discounts etc.)
    const resp = await shopifyRest(`/orders/${crmOrder.shopifyOrderId}/refunds/calculate.json`, {
      method: "POST",
      body: JSON.stringify({
        refund: {
          shipping: { full_refund: false },
          refund_line_items: body.items.map((x) => ({
            line_item_id: Number(x.line_item_id),
            quantity: Number(x.quantity),
            restock_type: "no_restock",
          })),
        },
      }),
    });

    const text = await resp.text();
    if (!resp.ok) {
      return NextResponse.json({ error: `Shopify calculate failed: ${resp.status} ${text}` }, { status: 502 });
    }

    const json = JSON.parse(text);
    const refund = json?.refund || json;

    // Prefer Shopify’s computed transaction amount; fallback to subtotal+tax sum
    let amount = 0;
    const t0 = refund?.transactions?.[0];
    if (t0?.amount != null) {
      amount = Number(t0.amount);
    } else {
      const items: any[] = Array.isArray(refund?.refund_line_items) ? refund.refund_line_items : [];
      const subtotal = items.reduce((s, it) => s + (Number(it?.subtotal) || 0), 0);
      const tax = items.reduce((s, it) => s + (Number(it?.total_tax) || 0), 0);
      amount = subtotal + tax;
    }

    return NextResponse.json(
      {
        amount,
        currency: crmOrder.currency || "GBP",
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Refund preview error:", err);
    return NextResponse.json({ error: err?.message || "Preview failed" }, { status: 500 });
  }
}
