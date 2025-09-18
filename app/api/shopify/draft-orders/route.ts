// app/api/shopify/draft-orders/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { gidToNumericId } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function shopifyRest(path: string, init: RequestInit = {}) {
  const RAW_SHOP_DOMAIN = (process.env.SHOPIFY_SHOP_DOMAIN || "").trim();
  const SHOP_DOMAIN = RAW_SHOP_DOMAIN.replace(/^https?:\/\//i, "");
  const SHOP_ADMIN_TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
  const SHOPIFY_API_VERSION = (process.env.SHOPIFY_API_VERSION || "2024-07").trim();
  if (!SHOP_DOMAIN || !SHOP_ADMIN_TOKEN) throw new Error("Missing Shopify env vars");

  const url = `https://${SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const headers = new Headers(init.headers as any);
  headers.set("X-Shopify-Access-Token", SHOP_ADMIN_TOKEN);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");

  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${init.method || "GET"} ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const customerId: string = String(body?.customerId || "");
    const note: string | undefined = body?.note || undefined;
    const items: Array<{ variantId?: string; variantGid?: string; quantity?: number }> = Array.isArray(body?.items)
      ? body.items
      : [];

    if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    if (!items.length) return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });

    const crm = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { shopifyCustomerId: true, customerEmailAddress: true, salonName: true, customerName: true },
    });
    if (!crm) return NextResponse.json({ error: "CRM customer not found" }, { status: 404 });

    // Ensure we have a Shopify Customer reference (by id or email)
    let customerRef: any = undefined;
    if (crm.shopifyCustomerId) {
      customerRef = { id: Number(crm.shopifyCustomerId) };
    } else if (crm.customerEmailAddress) {
      // Let Shopify match on email if no id yet (it will attach by email on draft order)
      customerRef = { email: crm.customerEmailAddress };
    }

    const line_items = items.map((it) => {
      const idNum = it.variantId || gidToNumericId(it.variantGid || "");
      if (!idNum) throw new Error("Each item needs a variantId or variantGid");
      const qty = Math.max(1, Number(it.quantity || 1));
      return { variant_id: Number(idNum), quantity: qty };
    });

    const payload: any = {
      draft_order: {
        line_items,
        note,
      },
    };
    if (customerRef) payload.draft_order.customer = customerRef;

    const json = await shopifyRest(`/draft_orders.json`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const draft = json?.draft_order;
    const draftId = draft?.id;
    const adminUrl = draftId
      ? `https://${(process.env.SHOPIFY_SHOP_DOMAIN || "").replace(/^https?:\/\//i, "")}/admin/draft_orders/${draftId}`
      : null;

    return NextResponse.json({
      ok: true,
      draftOrderId: draftId,
      status: draft?.status || null,
      invoiceUrl: draft?.invoice_url || null,
      adminUrl,
    });
  } catch (err: any) {
    console.error("[draft-orders] error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Failed to create draft order" }, { status: 500 });
  }
}
