// app/api/shopify/draft-orders/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify"; // keep for parity; we’ll use our own GQL call below too

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

/** Convert numeric Shopify ID -> GraphQL gid, e.g. 123 -> gid://shopify/ProductVariant/123 */
function gid(kind: "ProductVariant" | "Customer" | "DraftOrder" | "PaymentTermsTemplate", id: number | string) {
  return `gid://shopify/${kind}/${String(id)}`;
}

/** Simple GraphQL caller using your Admin token & shop domain. */
async function shopifyGraphQL<T = any>(query: string, variables?: Record<string, any>) {
  const shop = (process.env.SHOPIFY_SHOP_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN || "";
  const apiVer = process.env.SHOPIFY_API_VERSION || "2025-07";

  if (!shop || !token) {
    throw new Error("Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN env vars.");
  }

  const resp = await fetch(`https://${shop}/admin/api/${apiVer}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await resp.text();
  let json: any = {};
  try {
    json = JSON.parse(text || "{}");
  } catch {
    // leave as is
  }
  return { ok: resp.ok, status: resp.status, text, json };
}

/** Get all PaymentTerms templates (name → id mapping). */
async function fetchTermsTemplates(): Promise<Array<{ id: string; name: string; paymentTermsType: string; dueInDays: number | null }>> {
  const q = `
    query Templates {
      paymentTermsTemplates {
        id
        name
        paymentTermsType
        dueInDays
      }
    }
  `;
  const { ok, json, status, text } = await shopifyGraphQL(q);
  if (!ok || json?.errors) {
    throw new Error(`Failed to fetch paymentTermsTemplates (${status}): ${json?.errors?.[0]?.message || text}`);
  }
  return (json?.data?.paymentTermsTemplates ?? []) as any[];
}

/** Map whatever we stored to Shopify’s canonical template name. */
function canonicalName(name?: string | null, due?: number | null): string | null {
  if (!name) return null;
  const s = name.trim();

  if (/^Due on receipt$/i.test(s)) return "Due on receipt";
  if (/^Due on fulfillment$/i.test(s)) return "Due on fulfillment";
  if (/^Fixed/i.test(s)) return "Fixed";

  const within = s.match(/within\s+(\d+)\s*days?/i);
  const net = s.match(/net\s*(\d+)/i);
  const d = within ? Number(within[1]) : net ? Number(net[1]) : Number.isFinite(due as any) ? Number(due) : NaN;
  if ([7, 15, 30, 45, 60, 90].includes(d)) return `Net ${d}`;

  return null;
}

/** Build a PaymentTermsInput for GraphQL, including a schedule for NET terms (issuedAt = today). */
function buildPaymentTermsInput(
  template: { id: string; name: string; paymentTermsType: string; dueInDays: number | null }
) {
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const isoDate = `${yyyy}-${mm}-${dd}`; // YYYY-MM-DD

  // For NET, Shopify 2025-07 requires a schedule with an issuedAt date
  if (template.paymentTermsType === "NET") {
    return {
      paymentTermsTemplateId: template.id,
      paymentSchedules: [
        {
          issuedAt: isoDate,
        },
      ],
    };
  }

  // For receipt/fulfillment/fixed, just the template is fine
  return {
    paymentTermsTemplateId: template.id,
  };
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

    // Lookup CRM customer + saved terms
    let shopifyCustomerIdNum: number | null = null;
    let email: string | undefined;
    let savedPaymentDueLater = false;
    let savedPaymentTermsName: string | null = null;
    let savedPaymentTermsDueInDays: number | null = null;

    if (crmCustomerId) {
      const c = await prisma.customer.findUnique({
        where: { id: String(crmCustomerId) },
        select: {
          shopifyCustomerId: true,
          customerEmailAddress: true,
          paymentDueLater: true,
          paymentTermsName: true,
          paymentTermsDueInDays: true,
        },
      });

      if (c) {
        if (c.shopifyCustomerId) shopifyCustomerIdNum = Number(c.shopifyCustomerId);
        email = c.customerEmailAddress ?? undefined;
        savedPaymentDueLater = !!c.paymentDueLater;
        savedPaymentTermsName = c.paymentTermsName ?? null;
        savedPaymentTermsDueInDays = typeof c.paymentTermsDueInDays === "number" ? c.paymentTermsDueInDays : null;
      }
    }

    // ---------- Create via GraphQL so Payment Terms are applied ----------
    // Find the template we should use
    let sentPaymentTerms: any = null;
    let paymentTermsInput: any = null;

    if (applyPaymentTerms && savedPaymentDueLater && savedPaymentTermsName) {
      const want = canonicalName(savedPaymentTermsName, savedPaymentTermsDueInDays);
      if (want) {
        const templates = await fetchTermsTemplates();
        const tpl =
          templates.find((t) => t.name === want) ||
          // tolerate a bit of mismatch (“Fixed date” vs “Fixed”)
          (want === "Fixed" ? templates.find((t) => /^Fixed/i.test(t.name)) : null);

        if (!tpl) {
          return NextResponse.json(
            { error: `No matching PaymentTerms template found for "${want}" on this shop.` },
            { status: 400 }
          );
        }
        paymentTermsInput = buildPaymentTermsInput(tpl);
        sentPaymentTerms = paymentTermsInput;
      }
    }

    // Build GQL DraftOrderInput
    const draftInput: any = {
      note: "Created from SBP CRM",
      useCustomerDefaultAddress: true,
      lineItems: line_items.map((li) => ({
        variantId: gid("ProductVariant", li.variant_id),
        quantity: Number(li.quantity || 1),
        // price is optional on Drafts; omit unless you are overriding
      })),
      ...(email ? { email } : {}),
      ...(shopifyCustomerIdNum ? { customerId: gid("Customer", shopifyCustomerIdNum) } : {}),
      ...(paymentTermsInput ? { paymentTerms: paymentTermsInput } : {}),
    };

    const mutate = `
      mutation CreateDraft($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            paymentTerms {
              paymentTermsName
              paymentTermsType
              dueInDays
              nextPaymentSchedule { issuedAt dueAt }
            }
          }
          userErrors { field message }
        }
      }
    `;
    const { ok, json, status, text } = await shopifyGraphQL(mutate, { input: draftInput });
    if (!ok || json?.errors) {
      return NextResponse.json(
        { error: `Shopify draft create (GraphQL) error`, raw: json?.errors || text },
        { status: 400 }
      );
    }

    const userErrors = json?.data?.draftOrderCreate?.userErrors || [];
    if (userErrors.length) {
      return NextResponse.json(
        { error: `Shopify draft create (GraphQL) userErrors`, raw: userErrors },
        { status: 400 }
      );
    }

    const draft = json?.data?.draftOrderCreate?.draftOrder || null;
    if (!draft?.id) {
      return NextResponse.json(
        { error: "Shopify draft create (GraphQL) returned no id", raw: json },
        { status: 400 }
      );
    }

    // Return the draft + what we sent (for quick DevTools inspection)
    return NextResponse.json(
      {
        id: String(draft.id).replace(/.*\//, ""), // return numeric suffix if you prefer
        draft_order: { id: draft.id, payment_terms: draft.paymentTerms || null },
        sentPaymentTerms,
        draftPaymentTerms: draft.paymentTerms || null,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
    // -------------------------------------------------------------
  } catch (e: any) {
    console.error("Create draft error:", e);
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

// Keep GET blocked (you create drafts with POST only)
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
