// app/api/shopify/draft-orders/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyLine =
  | {
      variant_id?: number | string;
      variantId?: number | string;
      quantity?: number | string;
      price?: number | string;
      title?: string;
    }
  | Record<string, any>;

function toNum(n: any): number | undefined {
  const v = typeof n === "string" ? Number(n) : n;
  return Number.isFinite(v) ? v : undefined;
}

function pickLines(
  body: any
): Array<{ variant_id: number; quantity: number; price?: number; title?: string }> {
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

/** Canonicalise to Shopify terms & type; also extract due days for NET. */
function canonicalizeTerms(
  name?: string | null,
  dueInDays?: number | null
): null | {
  payment_terms_name: string;
  payment_terms_type: "NET" | "RECEIPT" | "FULFILLMENT" | "FIXED";
  due_in_days?: number;
} {
  if (!name) return null;
  const s = String(name).trim();

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

  const within = s.match(/within\s+(\d+)\s*days?/i);
  const parsed =
    within?.[1] ??
    s.match(/net\s*(\d+)/i)?.[1] ??
    (Number.isFinite(dueInDays as any) ? String(dueInDays) : undefined);

  const netNum = parsed ? Number(parsed) : undefined;
  if (netNum && [7, 15, 30, 45, 60, 90].includes(netNum)) {
    return { payment_terms_name: `Net ${netNum}`, payment_terms_type: "NET", due_in_days: netNum };
  }

  if (/receipt/i.test(s)) return { payment_terms_name: "Due on receipt", payment_terms_type: "RECEIPT" };
  if (/fulfil?ment/i.test(s))
    return { payment_terms_name: "Due on fulfillment", payment_terms_type: "FULFILLMENT" };
  if (/fixed/i.test(s)) return { payment_terms_name: "Fixed date", payment_terms_type: "FIXED" };

  return null;
}

// --- GraphQL helpers ---
const gid = {
  variant: (id: number | string) => `gid://shopify/ProductVariant/${String(id)}`,
  customer: (id: number | string) => `gid://shopify/Customer/${String(id)}`,
};

async function shopifyGraphQL(query: string, variables?: Record<string, any>): Promise<Response> {
  return shopifyRest(`/graphql.json`, {
    method: "POST",
    body: JSON.stringify({ query, variables }),
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

async function resolvePaymentTermsTemplateId(
  canonical:
    | {
        payment_terms_name: string;
        payment_terms_type: "NET" | "RECEIPT" | "FULFILLMENT" | "FIXED";
        due_in_days?: number;
      }
    | null
): Promise<string | null> {
  if (!canonical) return null;

  const q = /* GraphQL */ `
    query PaymentTermsTemplates {
      paymentTermsTemplates {
        id
        name
        paymentTermsType
        dueInDays
      }
    }
  `;

  const resp = await shopifyGraphQL(q);
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => ({} as any));
  const templates: Array<{ id: string; name: string; paymentTermsType: string; dueInDays?: number | null }> =
    data?.data?.paymentTermsTemplates || [];

  if (canonical.payment_terms_type === "NET") {
    const d = typeof canonical.due_in_days === "number" ? canonical.due_in_days : undefined;
    const t = templates.find(
      (x) => x.paymentTermsType === "NET" && typeof x.dueInDays === "number" && x.dueInDays === d
    );
    return t?.id || null;
  }

  const t = templates.find(
    (x) =>
      x.paymentTermsType === canonical.payment_terms_type &&
      (x.name?.toLowerCase() === canonical.payment_terms_name.toLowerCase())
  );
  return t?.id || null;
}

/** YYYY-MM-DD (Shopify GraphQL Date scalar expects this shape) */
function todayYMD(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const crmCustomerId: string | undefined =
      body.customerId ?? body.crmCustomerId ?? body.customer_id;
    const applyPaymentTerms: boolean = !!body.applyPaymentTerms;

    const line_items = pickLines(body);
    if (!line_items.length) {
      return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
    }

    // Lookup CRM customer and any saved terms
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
          first_name: (c.customerName || name || "").split(" ")[0] || undefined,
          last_name: (c.customerName || name || "").split(" ").slice(1).join(" ") || undefined,
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

    // REST payload (fallback/no-terms path)
    const restPayload: any = {
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

    // If we want terms, use GraphQL draftOrderCreate with a template id
    if (applyPaymentTerms && savedPaymentDueLater && savedPaymentTermsName) {
      const canonical = canonicalizeTerms(
        savedPaymentTermsName,
        savedPaymentTermsDueInDays
      );

      const templateId = await resolvePaymentTermsTemplateId(canonical);

      if (templateId) {
        const input: any = {
          note: "Created from SBP CRM",
          useCustomerDefaultAddress: true,
          lineItems: line_items.map((li) => ({
            variantId: gid.variant(li.variant_id),
            quantity: li.quantity,
          })),
          paymentTerms: {
            paymentTermsTemplateId: templateId,
            // 🔑 Required by Shopify for NET terms (safe to include always)
            issueDate: todayYMD(),
          },
          ...(email ? { email } : {}),
          ...(shopifyCustomerIdNum
            ? { customerId: gid.customer(shopifyCustomerIdNum) }
            : shipping_address
            ? {
                shippingAddress: {
                  address1: shipping_address.address1,
                  address2: shipping_address.address2,
                  city: shipping_address.city,
                  province: shipping_address.province,
                  zip: shipping_address.zip,
                  countryCode: shipping_address.country_code,
                  firstName: shipping_address.first_name,
                  lastName: shipping_address.last_name,
                },
              }
            : {}),
        };

        const m = /* GraphQL */ `
          mutation CreateDraft($input: DraftOrderInput!) {
            draftOrderCreate(input: $input) {
              draftOrder {
                id
                name
                paymentTerms { paymentTermsName paymentTermsType dueInDays issueDate }
              }
              userErrors { field message }
            }
          }
        `;

        const resp = await shopifyGraphQL(m, { input });
        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          return NextResponse.json(
            { error: `Shopify draft create (GraphQL) failed: ${resp.status} ${text}` },
            { status: 400, headers: { "Cache-Control": "no-store" } }
          );
        }

        const data = await resp.json().catch(() => ({} as any));
        const err = data?.data?.draftOrderCreate?.userErrors?.[0]?.message;
        const draftGid: string | null = data?.data?.draftOrderCreate?.draftOrder?.id || null;
        const draftPT: any = data?.data?.draftOrderCreate?.draftOrder?.paymentTerms || null;

        if (err) {
          return NextResponse.json(
            { error: `Shopify draft create (GraphQL) error: ${err}` },
            { status: 400, headers: { "Cache-Control": "no-store" } }
          );
        }
        if (!draftGid) {
          return NextResponse.json(
            { error: "Shopify draft create (GraphQL) returned no id", raw: data },
            { status: 400, headers: { "Cache-Control": "no-store" } }
          );
        }

        const numericId = Number(draftGid.split("/").pop());
        const load = await shopifyRest(`/draft_orders/${numericId}.json`, { method: "GET" });
        if (!load.ok) {
          const t = await load.text().catch(() => "");
          return NextResponse.json(
            {
              id: String(numericId),
              draft_order: null,
              sentPaymentTerms: { templateId, issueDate: todayYMD() },
              draftPaymentTerms: draftPT,
              warn: `Draft created, but failed to load via REST: ${load.status} ${t}`,
            },
            { status: 200, headers: { "Cache-Control": "no-store" } }
          );
        }
        const draftJson = await load.json().catch(() => ({}));
        const draft = draftJson?.draft_order || null;

        return NextResponse.json(
          {
            id: String(numericId),
            draft_order: draft,
            sentPaymentTerms: { templateId, issueDate: todayYMD() },
            draftPaymentTerms: draftPT,
          },
          { status: 200, headers: { "Cache-Control": "no-store" } }
        );
      }

      // No template found → fallback REST create (no terms), but echo what we tried
      const resp = await shopifyRest(`/draft_orders.json`, {
        method: "POST",
        body: JSON.stringify(restPayload),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        return NextResponse.json(
          {
            error: `Shopify draft create failed (REST fallback, no template match): ${resp.status} ${text}`,
          },
          { status: 400, headers: { "Cache-Control": "no-store" } }
        );
      }
      const json = await resp.json().catch(() => ({}));
      const draft = json?.draft_order || null;
      if (!draft?.id) {
        return NextResponse.json(
          { error: "Draft created (REST fallback) but response did not include an id", raw: json },
          { status: 500, headers: { "Cache-Control": "no-store" } }
        );
      }
      return NextResponse.json(
        {
          id: String(draft.id),
          draft_order: draft,
          sentPaymentTerms: { templateResolved: null },
          draftPaymentTerms: draft?.payment_terms || null,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    // No terms path -> plain REST create
    const resp = await shopifyRest(`/draft_orders.json`, {
      method: "POST",
      body: JSON.stringify(restPayload),
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
        sentPaymentTerms: null,
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
