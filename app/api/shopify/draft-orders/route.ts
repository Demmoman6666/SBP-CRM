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

/**
 * Canonicalize stored terms to Shopify’s REST Admin shape:
 *   - payment_terms_name (ex: "Net 30", "Due on receipt", "Due on fulfillment")
 *   - payment_terms_type (ex: "NET", "RECEIPT", "FULFILLMENT", "FIXED")
 *   - due_in_days (for NET only)
 */
function canonicalizeTerms(name?: string | null, dueInDays?: number | null): null | {
  payment_terms_name: string;
  payment_terms_type: "NET" | "RECEIPT" | "FULFILLMENT" | "FIXED";
  due_in_days?: number;
} {
  if (!name) return null;
  const s = String(name).trim();

  // Direct matches first
  if (/^Due on receipt$/i.test(s)) {
    return { payment_terms_name: "Due on receipt", payment_terms_type: "RECEIPT" };
  }
  if (/^Due on fulfillment$/i.test(s)) {
    return { payment_terms_name: "Due on fulfillment", payment_terms_type: "FULFILLMENT" };
  }
  if (/^Fixed date$/i.test(s)) {
    return { payment_terms_name: "Fixed date", payment_terms_type: "FIXED" };
  }
  const netDirect = s.match(/^Net\s*(7|15|30|45|60|90)$/i);
  if (netDirect) {
    const d = Number(netDirect[1]);
    return { payment_terms_name: `Net ${d}`, payment_terms_type: "NET", due_in_days: d };
  }

  // Tolerate “Within 30 days”, “Net 30 days”, plain “30”
  const within = s.match(/within\s+(\d+)\s*days?/i);
  const netNum = within ? Number(within[1])
    : (s.match(/net\s*(\d+)/i)?.[1] ? Number(s.match(/net\s*(\d+)/i)![1]) : undefined)
      ?? (Number.isFinite(dueInDays as any) ? Number(dueInDays) : undefined);

  if (netNum && [7, 15, 30, 45, 60, 90].includes(netNum)) {
    return { payment_terms_name: `Net ${netNum}`, payment_terms_type: "NET", due_in_days: netNum };
  }

  // Fallbacks for fuzzy words
  if (/receipt/i.test(s)) return { payment_terms_name: "Due on receipt", payment_terms_type: "RECEIPT" };
  if (/fulfil?ment/i.test(s)) return { payment_terms_name: "Due on fulfillment", payment_terms_type: "FULFILLMENT" };
  if (/fixed/i.test(s)) return { payment_terms_name: "Fixed date", payment_terms_type: "FIXED" };

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

    // Lookup customer + any saved terms
    let shopifyCustomerIdNum: number | null = null;
    let email: string | undefined;
    let shipping_address: any | undefined;

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
        savedPaymentTermsDueInDays = typeof c.paymentTermsDueInDays === "number" ? c.paymentTermsDueInDays : null;
      }
    }

    const payload: any = {
      draft_order: {
        line_items,
        taxes_included: false, // prices are ex VAT
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

    // Attach terms in the exact shape (for 2025-07+ some shops require type as well)
    let sentPaymentTerms: any = null;
    if (applyPaymentTerms && savedPaymentDueLater && savedPaymentTermsName) {
      const canonical = canonicalizeTerms(savedPaymentTermsName, savedPaymentTermsDueInDays);
      if (canonical) {
        payload.draft_order.payment_terms = {
          payment_terms_name: canonical.payment_terms_name,
          payment_terms_type: canonical.payment_terms_type,
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

    return NextResponse.json(
      {
        id: String(draft.id),
        draft_order: draft,
        sentPaymentTerms,                  // <-- inspect in DevTools Response
        draftPaymentTerms: draft?.payment_terms || null, // <-- inspect too
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

// Optional: keep other verbs blocked so only POST is used for creation
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
