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

/** Map whatever we stored to Shopify’s canonical names and due_in_days. */
function canonicalizeTerms(name?: string | null, dueInDays?: number | null) {
  if (!name) return null;
  const n = name.trim();

  // Exact Shopify-accepted names first
  const allowed = new Set([
    "Due on receipt",
    "Due on fulfillment",
    "Net 7",
    "Net 15",
    "Net 30",
    "Net 45",
    "Net 60",
    "Net 90",
    "Fixed date",
  ]);
  if (allowed.has(n)) {
    if (n.startsWith("Net ")) {
      const d = Number(n.replace("Net", "").trim());
      return { payment_terms_name: n, due_in_days: Number.isFinite(d) ? d : undefined };
    }
    // receipt / fulfillment / fixed date -> no due_in_days
    return { payment_terms_name: n };
  }

  // Tolerate labels like "Net 30 days" or "Within 30 days"
  const mNet = n.match(/net\s*(\d+)/i);
  const mWithin = n.match(/within\s*(\d+)\s*days?/i);
  const netNum = mNet ? Number(mNet[1]) : mWithin ? Number(mWithin[1]) : (Number.isFinite(dueInDays as any) ? (dueInDays as number) : null);
  if (netNum && [7, 15, 30, 45, 60, 90].includes(netNum)) {
    return { payment_terms_name: `Net ${netNum}`, due_in_days: netNum };
  }
  if (/receipt/i.test(n)) return { payment_terms_name: "Due on receipt" };
  if (/fulfillment|fulfilment/i.test(n)) return { payment_terms_name: "Due on fulfillment" };
  if (/fixed/i.test(n)) return { payment_terms_name: "Fixed date" };

  // If we can’t recognise it, don’t send terms at all
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const crmCustomerId: string | undefined = body.customerId ?? body.crmCustomerId ?? body.customer_id;
    const applyPaymentTerms: boolean = !!body.applyPaymentTerms;

    const line_items = pickLines(body);
    if (!line_items.length) {
      return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
    }

    // Look up CRM customer to attach Shopify customer or address, AND terms
    let shopifyCustomerIdNum: number | null = null;
    let email: string | undefined;
    let shipping_address: any | undefined;

    // Saved terms
    let savedPaymentDueLater = false;
    let savedPaymentTermsName: string | null = null;
    let savedPaymentTermsDueInDays: number | null = null;

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

        savedPaymentDueLater = !!c.paymentDueLater;
        savedPaymentTermsName = c.paymentTermsName ?? null;
        savedPaymentTermsDueInDays =
          typeof c.paymentTermsDueInDays === "number" ? c.paymentTermsDueInDays : null;
      }
    }

    // Build Shopify Draft payload
    const payload: any = {
      draft_order: {
        line_items,
        taxes_included: false, // unit prices are ex VAT
        use_customer_default_address: true,
        note: "Created from SBP CRM",
        ...(email ? { email } : {}),
        ...(shopifyCustomerIdNum
          ? { customer: { id: shopifyCustomerIdNum } }
          : shipping_address
          ? { shipping_address }
          : {}),
      },
    };

    // Attach payment terms ONLY for "Pay on account" flow AND if customer has them saved
    let sentPaymentTerms: any = null;
    if (applyPaymentTerms && savedPaymentDueLater && savedPaymentTermsName) {
      const canonical = canonicalizeTerms(savedPaymentTermsName, savedPaymentTermsDueInDays);
      if (canonical) {
        // For "Due on receipt" / "Due on fulfillment" there is no due_in_days
        // For "Net X" we include due_in_days: X
        payload.draft_order.payment_terms = {
          payment_terms_name: canonical.payment_terms_name,
          ...(typeof canonical.due_in_days === "number" ? { due_in_days: canonical.due_in_days } : {}),
        };
        sentPaymentTerms = payload.draft_order.payment_terms;
      }
    }

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

    // Echo what we sent + what Shopify says the draft now has
    return NextResponse.json(
      {
        id: String(draft.id),
        draft_order: draft,
        sentPaymentTerms,
        draftPaymentTerms: draft?.payment_terms || null,
      },
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

export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
