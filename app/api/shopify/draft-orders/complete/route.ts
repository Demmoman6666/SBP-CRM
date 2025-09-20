// app/api/shopify/draft-orders/complete/route.ts
import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const draftIdRaw = body?.draftId ?? body?.id ?? body?.draft_id;
    const draftId = String(draftIdRaw || "").trim();
    if (!draftId) {
      return NextResponse.json({ error: "Missing draftId" }, { status: 400 });
    }

    // ✅ Use query param payment_pending=true (most reliable)
    const url = `/draft_orders/${encodeURIComponent(draftId)}/complete.json?payment_pending=true`;

    // Send an empty body. Some API versions 422 if you send the flag in the JSON body.
    const resp = await shopifyRest(url, {
      method: "POST",
      // No JSON body required; set minimal headers
      // body: JSON.stringify({}),  // <- not needed
    });

    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      // Surface Shopify's message so you can see exactly why (inventory, terms, etc.)
      return NextResponse.json(
        { error: `Shopify draft complete failed: ${resp.status}`, detail: text || null },
        { status: 400 }
      );
    }

    const json = text ? JSON.parse(text) : {};
    const order = json?.order ?? null;

    return NextResponse.json(
      {
        ok: true,
        orderId: order?.id ? String(order.id) : null,
        orderName: order?.name ?? null,
        order, // echo full order for debugging; remove later if you prefer
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
