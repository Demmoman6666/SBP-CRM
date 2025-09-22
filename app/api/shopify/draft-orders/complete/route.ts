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

    // 1) Complete the draft as unpaid (payment pending).
    //    Important: Shopify expects the flag in the query string and *no JSON body*.
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

    // 2) If we got an order, upsert metadata into note_attributes AND a human line into the text Notes.
    if (orderId) {
      try {
        // ---- note_attributes (machine-friendly) ----
        const existingNotesArr: Array<{ name?: string; value?: string }> = Array.isArray(order?.note_attributes)
          ? order.note_attributes
          : [];

        const notesMap = new Map<string, string>();
        for (const n of existingNotesArr) {
          const key = (n?.name || "").toString();
          if (key) notesMap.set(key, (n?.value || "").toString());
        }

        // Our markers
        notesMap.set("crm_payment_method", "account");
        if (paymentTermsName) notesMap.set("crm_payment_terms", paymentTermsName);

        const note_attributes = Array.from(notesMap.entries()).map(([name, value]) => ({ name, value }));

        // ---- Notes (human-friendly text) ----
        const existingNoteText: string = typeof order?.note === "string" ? order.note : "";
        const intro = "Created from SBP CRM";
        const termsLine = paymentTermsName ? `Payment terms (CRM): ${paymentTermsName}` : null;

        // Build next note text idempotently
        const lines: string[] = [];
        const haveIntro = existingNoteText.includes(intro);
        if (existingNoteText.trim()) lines.push(existingNoteText.trim());
        if (!haveIntro) lines.push(intro);
        if (termsLine && !existingNoteText.includes(termsLine)) lines.push(termsLine);

        const note = lines.join("\n");

        // Only PUT if something actually changes
        const willChangeNote = note !== existingNoteText;
        const willChangeAttrs =
          JSON.stringify(
            (existingNotesArr || []).map((n) => ({ name: n?.name || "", value: n?.value || "" })).sort((a, b) =>
              a.name.localeCompare(b.name)
            )
          ) !==
          JSON.stringify(
            note_attributes.map((n) => ({ name: n.name, value: n.value })).sort((a, b) =>
              a.name.localeCompare(b.name)
            )
          );

        if (willChangeNote || willChangeAttrs) {
          const upd = await shopifyRest(`/orders/${orderId}.json`, {
            method: "PUT",
            body: JSON.stringify({
              order: {
                id: orderId,
                ...(willChangeNote ? { note } : {}),
                ...(willChangeAttrs ? { note_attributes } : {}),
              },
            }),
          });

          if (!upd.ok) {
            const t = await upd.text().catch(() => "");
            console.warn("Order update (note / note_attributes) failed:", upd.status, t);
          }
        }
      } catch (e) {
        console.warn("Order metadata/notes augmentation error:", e);
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
