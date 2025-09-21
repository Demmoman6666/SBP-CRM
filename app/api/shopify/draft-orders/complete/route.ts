// app/api/shopify/draft-orders/complete/route.ts
import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // Expect: { draftId: number | string, paymentTermsName?: string }
    const body = await req.json().catch(() => ({} as any));
    const draftIdRaw = body?.draftId ?? body?.id ?? body?.draft_id;
    const draftIdNum = Number(draftIdRaw);
    if (!Number.isFinite(draftIdNum) || draftIdNum <= 0) {
      return NextResponse.json(
        { error: "Missing or invalid draftId" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const paymentTermsName: string | null =
      typeof body?.paymentTermsName === "string" && body.paymentTermsName.trim()
        ? body.paymentTermsName.trim()
        : null;

    // Shopify requires the query-string flag and NO JSON body.
    // PUT /draft_orders/{id}/complete.json?payment_pending=true
    const completePath = `/draft_orders/${draftIdNum}/complete.json?payment_pending=true`;
    const resp = await shopifyRest(completePath, { method: "PUT" });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return NextResponse.json(
        { error: `Shopify draft complete failed: ${resp.status} ${text}` },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const json = await resp.json().catch(() => ({}));
    const order = json?.order ?? null;
    const orderId = order?.id ?? null;

    // If we got an order back, upsert ONLY note attributes (no tags).
    if (orderId) {
      try {
        const existingNotes: Array<{ name?: string; value?: string }> = Array.isArray(order.note_attributes)
          ? order.note_attributes
          : [];

        // Build a map so we can upsert
        const notesMap = new Map<string, string>();
        for (const n of existingNotes) {
          const key = (n?.name || "").toString();
          if (key) notesMap.set(key, (n?.value || "").toString());
        }

        // Our markers
        notesMap.set("crm_payment_method", "account");
        if (paymentTermsName) notesMap.set("crm_payment_terms", paymentTermsName);

        const note_attributes = Array.from(notesMap.entries()).map(([name, value]) => ({ name, value }));

        const upd = await shopifyRest(`/orders/${orderId}.json`, {
          method: "PUT",
          body: JSON.stringify({ order: { id: orderId, note_attributes } }),
        });

        if (!upd.ok) {
          const t = await upd.text().catch(() => "");
          console.warn("Order note_attributes update failed:", upd.status, t);
        }
      } catch (e) {
        console.warn("Order note_attributes augmentation error:", e);
      }
    }

    return NextResponse.json(
      { ok: true, orderId, order },
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
