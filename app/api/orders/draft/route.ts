// app/api/orders/draft/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest, pushCustomerToShopifyById, SHOPIFY_API_VERSION } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PostBody = {
  customerId: string;
  lines: Array<{ variantId: string; quantity: number }>;
  note?: string;
  // allow either a string or an array to be sent; we’ll normalize to a comma-separated string
  tags?: string | string[];
};

function normalizeTags(input?: string | string[] | null): string | undefined {
  if (input == null) return undefined;
  if (Array.isArray(input)) {
    return input.map(String).map(s => s.trim()).filter(Boolean).join(", ");
  }
  const s = String(input).trim();
  if (!s) return undefined;
  // If someone sent a JSON array encoded as a string (e.g. '["A","B"]'), parse it.
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        return arr.map(String).map(t => t.trim()).filter(Boolean).join(", ");
      }
    } catch {}
  }
  return s;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const { customerId, lines } = body || ({} as any);
    const note = typeof body?.note === "string" ? body.note : undefined;

    if (!customerId) {
      return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
    }

    const crm = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!crm) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    // Ensure customer exists in Shopify
    let shopifyCustomerId = crm.shopifyCustomerId || null;
    if (!shopifyCustomerId) {
      await pushCustomerToShopifyById(crm.id);
      const updated = await prisma.customer.findUnique({ where: { id: crm.id } });
      shopifyCustomerId = updated?.shopifyCustomerId || null;
    }
    if (!shopifyCustomerId) {
      return NextResponse.json({ error: "Failed to ensure Shopify customer record" }, { status: 500 });
    }

    const line_items = lines.map((l) => ({
      variant_id: Number(l.variantId),
      quantity: Math.max(1, Number(l.quantity || 1)),
    }));

    // REST requires a *string* for tags, not an array
    const tagString = normalizeTags(body?.tags) ?? "CRM";

    const payload = {
      draft_order: {
        customer: { id: Number(shopifyCustomerId) },
        line_items,
        use_customer_default_address: true,
        tags: tagString, // ✅ always a comma-separated string
        note: note ?? `Created from CRM for ${crm.salonName || crm.customerName || "Customer"}`,
      },
    };

    const res = await shopifyRest(`/draft_orders.json`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: `Shopify draft order failed: ${res.status} ${text}` }, { status: 502 });
    }
    const json = JSON.parse(text);
    const draft = json?.draft_order;
    const draftId = draft?.id ? String(draft.id) : null;

    const adminUrl = draftId
      ? `https://${(process.env.SHOPIFY_SHOP_DOMAIN || "").replace(/^https?:\/\//, "")}/admin/draft_orders/${draftId}`
      : null;

    return NextResponse.json({
      ok: true,
      shopifyDraftOrderId: draftId,
      invoiceUrl: draft?.invoice_url || null,
      adminUrl,
      apiVersion: SHOPIFY_API_VERSION,
    });
  } catch (err: any) {
    console.error("Create draft order error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
