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

    // Shopify wants PUT + payment_pending=true as a query param.
    const resp = await shopifyRest(
      `/draft_orders/${draftId}/complete.json?payment_pending=true`,
      {
        method: "PUT",
        // Be explicit; some shops return 406 without Accept.
        headers: { Accept: "application/json" },
      }
    );

    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      // Surface Shopify’s error payload to the browser so you can see why it rejected
      return NextResponse.json(
        { error: `Shopify draft complete failed: ${resp.status}`, shopify: text },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch {}
    const draft = json?.draft_order || json;
    const orderId = draft?.order_id ?? draft?.order?.id ?? null;

    let orderAdminUrl: string | null = null;
    if (orderId && process.env.SHOPIFY_SHOP_DOMAIN) {
      const shop = process.env.SHOPIFY_SHOP_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
      orderAdminUrl = `https://${shop}/admin/orders/${orderId}`;
    }

    return NextResponse.json(
      { ok: true, draft_id: draftId, order_id: orderId, orderAdminUrl, raw: json },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.error("Complete draft error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
