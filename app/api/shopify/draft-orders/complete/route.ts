// app/api/shopify/draft-orders/complete/route.ts
import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // Expect: { draftId: number | string }
    const body = await req.json().catch(() => ({} as any));
    const draftIdRaw = body?.draftId ?? body?.id ?? body?.draft_id;
    const draftIdNum = Number(draftIdRaw);
    if (!Number.isFinite(draftIdNum) || draftIdNum <= 0) {
      return NextResponse.json(
        { error: "Missing or invalid draftId" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Shopify requires the query-string flag and NO JSON body.
    // Use PUT /draft_orders/{id}/complete.json?payment_pending=true
    const path = `/draft_orders/${draftIdNum}/complete.json?payment_pending=true`;
    const resp = await shopifyRest(path, { method: "PUT" });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return NextResponse.json(
        { error: `Shopify draft complete failed: ${resp.status} ${text}` },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const json = await resp.json().catch(() => ({}));
    // Shopify returns { order: {...} }
    const order = json?.order ?? null;
    return NextResponse.json(
      { ok: true, orderId: order?.id ?? null, order },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

// Optional: block GET/others
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
