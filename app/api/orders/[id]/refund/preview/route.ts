// app/api/orders/[id]/refund/preview/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  items: Array<{ crmLineId: string; quantity: number }>;
  reason?: string | null;
};

function decimalToMinor(amount: string | number) {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const { items, reason } = (await req.json()) as Body;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ amount: "0.00" }, { status: 200 });
    }

    const order = await prisma.order.findUnique({
      where: { id: ctx.params.id },
      include: { lineItems: true },
    });
    if (!order?.shopifyOrderId) {
      return NextResponse.json({ error: "Order not linked to Shopify" }, { status: 400 });
    }

    const byId = new Map(order.lineItems.map((li) => [li.id, li]));
    const refund_line_items = items
      .map((i) => {
        const li = byId.get(i.crmLineId);
        if (!li?.shopifyLineItemId) return null;
        const max = Math.max(0, Number(li.quantity || 0));
        const qty = Math.min(Math.max(0, Number(i.quantity || 0)), max);
        if (!qty) return null;
        return {
          line_item_id: Number(li.shopifyLineItemId),
          quantity: qty,
          restock_type: "no_restock" as const,
        };
      })
      .filter(Boolean);

    if (!refund_line_items.length) {
      return NextResponse.json({ amount: "0.00" }, { status: 200 });
    }

    const calcRes = await shopifyRest(`/orders/${order.shopifyOrderId}/refunds/calculate.json`, {
      method: "POST",
      body: JSON.stringify({
        refund: {
          currency: order.currency || "GBP",
          note: reason || undefined,
          shipping: { amount: "0.00" },
          refund_line_items,
        },
      }),
    });
    const text = await calcRes.text();
    if (!calcRes.ok) {
      return NextResponse.json(
        { error: `Shopify calculate failed: ${calcRes.status} ${text}` },
        { status: 502 }
      );
    }

    const j = JSON.parse(text);
    const amountStr =
      j?.refund?.transactions?.[0]?.amount ??
      j?.refund?.amount ??
      "0.00";

    // also return minor units if you want to show it elsewhere later
    return NextResponse.json({
      amount: amountStr,
      amount_minor: decimalToMinor(amountStr),
      currency: order.currency || "GBP",
    });
  } catch (err: any) {
    console.error("Refund preview error:", err);
    return NextResponse.json({ error: err?.message || "Preview failed" }, { status: 500 });
  }
}
