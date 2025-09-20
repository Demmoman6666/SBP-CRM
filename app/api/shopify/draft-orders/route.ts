// app/api/shopify/draft-orders/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyLine =
  | { variant_id?: number | string; variantId?: number | string; quantity?: number | string; price?: number | string; title?: string }
  | Record<string, any>;

function toNum(n: any): number | undefined {
  const v = typeof n === "string" ? Number(n) : n;
  return Number.isFinite(v) ? v : undefined;
}

function pickLines(body: any): Array<{ variant_id: number; quantity: number; price?: number; title?: string }> {
  const candidates: AnyLine[] =
    body?.lines ??
    body?.line_items ??
    body?.draft_order?.line_items ??
    body?.draftOrder?.lineItems ??
    body?.items ??
    body?.cart?.lines ??
    [];

  if (!Array.isArray(candidates)) return [];

  const out: Array<{ variant_id: number; quantity: number; price?: number; title?: string }> = [];
  for (const raw of candidates) {
    const variant_id = toNum(raw.variant_id ?? raw.variantId);
    const quantity = toNum(raw.quantity) ?? 1;
    if (!variant_id || quantity <= 0) continue;

    const price = toNum(raw.price);
    const title = typeof raw.title === "string" ? raw.title : undefined;

    out.push({ variant_id, quantity, ...(price != null ? { price } : {}), ...(title ? { title } : {}) });
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const crmCustomerId: string | undefined = body.customerId ?? body.crmCustomerId ?? body.customer_id;

    // NEW: only apply payment terms if the client asked us to (e.g., Pay on account)
    const applyPaymentTerms: boolean = !!body.applyPaymentTerms;

    const line_items = pickLines(body);
    if (!line_items.length) {
      return NextResponse.json({ error: "At least one line item is required" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    // Look up CRM customer to attach Shopify customer or address
    let shopifyCustomerIdNum: number | null = null;
    let email: string | undefined;
    let shipping_address: any | undefined;

    // Payment terms pulled from CRM
    let paymentDueLater = false;
    let paymentTermsName: string | null = null;
    let paymentTermsDueInDays: number | null = null;

    if (crmCustomerId) {
      const c = await prisma.customer.findUnique({
        where: { id: String(crmCustomerId) },
        select: {
          shopifyCustomerId: true,
          customerEmailAddress: true,
          customerName: true,
          salonName: true,
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

      if (c) {
        if (c.shopifyCustomerId) shopifyCustomerIdNum = Number(c.shopifyCustomerId);
        email = c.customerEmailAddress ?? undefined;
        const name = c.salonName || c.customerName || undefined;
        shipping_address = {
          name,
          address1: c.addressLine1 || undefined,
          address2: c.addressLine2 || undefined,
          city: c.town || undefined,
          province: c.county || undefined,
          zip: c.postCode || undefined,
          country_code: (c.country || "GB").toUpperCase(),
        };

        paymentDueLater = !!c.paymentDueLater;
        paymentTermsName = c.paymentTermsName ?? null;
        paymentTermsDueInDays =
          typeof c.paymentTermsDueInDays === "number" ? c.paymentTermsDueInDays : null;
      }
    }

    // Build Shopify Draft Order payload (REST Admin API)
    // Only include payment_terms when the client explicitly asked (applyPaymentTerms)
    // and the customer has Payment due later enabled in CRM.
    const payload: any = {
      draft_order: {
        line_items,
        taxes_included: false, // we send EX VAT unit prices
        use_customer_default_address: true,
        note: "Created from SBP CRM",
        ...(email ? { email } : {}),
        ...(shopifyCustomerIdNum
          ? { customer: { id: shopifyCustomerIdNum } }
          : shipping_address
          ? { shipping_address }
          : {}),

        // NEW: apply saved Payment Terms when requested + enabled.
        ...(applyPaymentTerms && paymentDueLater
          ? {
              payment_terms: {
                // If name missing for any reason, default to a safe, valid option
                payment_terms_name: paymentTermsName || "Due on receipt",
                ...(Number.isFinite(paymentTermsDueInDays as any)
                  ? { due_in_days: paymentTermsDueInDays }
                  : {}),
              },
            }
          : {}),
      },
    };

    const resp = await shopifyRest(`/draft_orders.json`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return NextResponse.json(
        { error: `Shopify draft create failed: ${resp.status} ${text}` },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const json = await resp.json().catch(() => ({}));
    const draft = json?.draft_order || null;
    if (!draft?.id) {
      return NextResponse.json(
        { error: "Draft created but response did not include an id", raw: json },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { id: String(draft.id), draft_order: draft },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.error("Create draft error:", e);
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

// Optional: block other verbs
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405, headers: { "Cache-Control": "no-store" } });
}
