import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Minimal cart line shape we accept from the client */
type LineIn = {
  variant_id: number | string;
  quantity: number | string;
  price?: number | string; // ex VAT unit price if you’re overriding
  title?: string;
};

function num(n: any): number | undefined {
  const v = typeof n === "string" ? Number(n) : n;
  return Number.isFinite(v) ? v : undefined;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const crmCustomerId: string | undefined = body.customerId;
    const linesIn: LineIn[] = Array.isArray(body.lines) ? body.lines : [];

    if (!crmCustomerId) {
      return NextResponse.json({ error: "Missing customerId" }, { status: 400 });
    }
    if (linesIn.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    // Look up CRM customer and their payment terms
    const customer = await prisma.customer.findUnique({
      where: { id: String(crmCustomerId) },
      select: {
        shopifyCustomerId: true,
        customerEmailAddress: true,
        salonName: true,
        customerName: true,
        addressLine1: true,
        addressLine2: true,
        town: true,
        county: true,
        postCode: true,
        country: true,
        paymentDueLater: true,
        paymentTermsName: true,
        paymentTermsDueInDays: true,
      },
    });

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    if (!customer.paymentDueLater || !customer.paymentTermsName) {
      return NextResponse.json({ error: "Customer has no account terms enabled" }, { status: 400 });
    }

    // Build line_items for Shopify Draft Order
    const line_items = linesIn
      .map((l) => {
        const variant_id = num(l.variant_id);
        const quantity = num(l.quantity) ?? 1;
        if (!variant_id || quantity <= 0) return null;
        const price = num(l.price);
        return {
          variant_id,
          quantity,
          ...(price != null ? { price } : {}),
          ...(l.title ? { title: String(l.title) } : {}),
        };
      })
      .filter(Boolean);

    if (line_items.length === 0) {
      return NextResponse.json({ error: "No valid line items" }, { status: 400 });
    }

    // Build payment terms block for Shopify
    // We set name + due_in_days when it’s a NET/X/WITHIN case; for “Due on receipt/fulfillment” due_in_days can be omitted.
    const termsName = customer.paymentTermsName;
    const dueIn = typeof customer.paymentTermsDueInDays === "number" ? customer.paymentTermsDueInDays : undefined;
    const payment_terms: any = { payment_terms_name: termsName };
    if (typeof dueIn === "number" && dueIn > 0) payment_terms.due_in_days = dueIn;

    // We create a Draft Order with the terms, then complete it with payment_pending=true.
    // Resulting Order is UNPAID + UNFULFILLED with the payment terms attached.
    const shipping_address =
      customer.addressLine1 || customer.town || customer.postCode
        ? {
            name: customer.salonName || customer.customerName || undefined,
            address1: customer.addressLine1 || undefined,
            address2: customer.addressLine2 || undefined,
            city: customer.town || undefined,
            province: customer.county || undefined,
            zip: customer.postCode || undefined,
            country_code: (customer.country || "GB").toUpperCase(),
          }
        : undefined;

    const draftPayload: any = {
      draft_order: {
        line_items,
        note: "Created from SBP CRM (Pay on account)",
        taxes_included: false, // prices are ex VAT in your flow
        payment_terms,
        ...(customer.customerEmailAddress ? { email: customer.customerEmailAddress } : {}),
        ...(customer.shopifyCustomerId
          ? { customer: { id: Number(customer.shopifyCustomerId) } }
          : shipping_address
          ? { shipping_address }
          : {}),
        use_customer_default_address: true,
      },
    };

    const createDraftRes = await shopifyRest(`/draft_orders.json`, {
      method: "POST",
      body: JSON.stringify(draftPayload),
    });
    if (!createDraftRes.ok) {
      const t = await createDraftRes.text().catch(() => "");
      return NextResponse.json({ error: `Draft create failed: ${createDraftRes.status} ${t}` }, { status: 400 });
    }
    const draft = (await createDraftRes.json())?.draft_order;
    if (!draft?.id) {
      return NextResponse.json({ error: "Draft created without id" }, { status: 500 });
    }

    // Complete as payment pending (creates the real Order as UNPAID)
    const completeRes = await shopifyRest(`/draft_orders/${draft.id}/complete.json?payment_pending=true`, {
      method: "PUT",
    });
    if (!completeRes.ok) {
      const t = await completeRes.text().catch(() => "");
      return NextResponse.json({ error: `Draft complete failed: ${completeRes.status} ${t}` }, { status: 400 });
    }
    const completed = (await completeRes.json())?.order;

    // Build handy URLs
    const shop = String(process.env.SHOPIFY_SHOP_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const adminUrl = completed?.id ? `https://${shop}/admin/orders/${completed.id}` : null;

    return NextResponse.json(
      {
        ok: true,
        orderId: completed?.id ? String(completed.id) : null,
        orderNumber: completed?.name || null,
        adminUrl,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
