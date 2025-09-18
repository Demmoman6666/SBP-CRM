// app/api/orders/draft/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest, pushCustomerToShopifyById, SHOPIFY_API_VERSION } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PostBody = {
  customerId: string;
  lines: Array<{ variantId: string; quantity: number }>;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PostBody;
    const { customerId, lines } = body || ({} as any);

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
      quantity: Number(l.quantity || 1),
    }));

    const payload = {
      draft_order: {
        customer: { id: Number(shopifyCustomerId) },
        line_items,
        use_customer_default_address: true,
        tags: ["CRM"], // optional
        note: `Created from CRM for ${crm.salonName || crm.customerName || "Customer"}`,
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
      ? `https://${process.env.SHOPIFY_SHOP_DOMAIN?.replace(/^https?:\/\//, "")}/admin/draft_orders/${draftId}`
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
