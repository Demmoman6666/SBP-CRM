// app/api/shopify/draft-orders/complete/route.ts
import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const draftIdRaw = body?.draftId ?? body?.id ?? body?.draft_id;
    const draftId = Number(draftIdRaw);
    if (!Number.isFinite(draftId)) {
      return NextResponse.json({ error: "Missing or invalid draftId" }, { status: 400 });
    }

    // Complete the draft as *payment pending* so it creates an UNPAID, UNFULFILLED order.
    // (Your draft creation endpoint already attaches payment_terms when requested.)
    const resp = await shopifyRest(`/draft_orders/${draftId}/complete.json`, {
      method: "POST",
      // Either query param or body works; body is clearer:
      body: JSON.stringify({ payment_pending: true }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return NextResponse.json(
        { error: `Shopify draft complete failed: ${resp.status} ${text}` },
        { status: 400 }
      );
    }

    const json = await resp.json().catch(() => ({}));
    const draft = json?.draft_order || json; // some shops return the draft_order wrapper
    const orderId = draft?.order_id ?? draft?.order?.id ?? null;

    // For convenience, give a quick Admin URL if we can
    let orderAdminUrl: string | null = null;
    if (orderId && process.env.SHOPIFY_SHOP_DOMAIN) {
      const shop = (process.env.SHOPIFY_SHOP_DOMAIN || "")
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "");
      orderAdminUrl = `https://${shop}/admin/orders/${orderId}`;
    }

    return NextResponse.json(
      {
        ok: true,
        draft_id: draftId,
        order_id: orderId,
        orderAdminUrl,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.error("Complete draft error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

// Optional: block other verbs
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
