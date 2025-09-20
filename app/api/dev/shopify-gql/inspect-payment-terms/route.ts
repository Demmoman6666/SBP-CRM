import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Minimal GraphQL client using your Admin API token + shop domain.
 * Requires env:
 *   SHOPIFY_SHOP_DOMAIN            (e.g. "your-shop.myshopify.com" or just the hostname)
 *   SHOPIFY_ADMIN_ACCESS_TOKEN     (private Admin token for your app)
 *   SHOPIFY_API_VERSION            (optional; defaults to "2025-07")
 */
async function shopifyGraphQL<T = any>(query: string, variables?: Record<string, any>) {
  const shopDomain = (process.env.SHOPIFY_SHOP_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const version = process.env.SHOPIFY_API_VERSION || "2025-07";
  const url = `https://${shopDomain}/admin/api/${version}/graphql.json`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const text = await resp.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!resp.ok) {
    throw new Error(`GraphQL HTTP ${resp.status}: ${text || "(no body)"}`);
  }
  return json as T;
}

const INTROSPECT_PAYMENT_TERMS_INPUT = /* GraphQL */ `
  query PaymentTermsInputShape {
    __type(name: "PaymentTermsInput") {
      name
      inputFields {
        name
        type { kind name ofType { kind name } }
      }
    }
  }
`;

const LIST_MUTATIONS = /* GraphQL */ `
  query AllMutations {
    __schema {
      mutationType {
        fields {
          name
          args {
            name
            type { kind name ofType { kind name } }
          }
        }
      }
    }
  }
`;

const LIST_TEMPLATES = /* GraphQL */ `
  query Templates {
    paymentTermsTemplates {
      id
      name
      paymentTermsType
      dueInDays
    }
  }
`;

/**
 * GET = run all three GraphQL queries and return a compact JSON:
 *   - inputShape: exact fields of PaymentTermsInput
 *   - mutationsSubset: only mutations whose name includes "draftOrder" and ("paymentTerms" or "PaymentTerms")
 *   - templates: available payment terms templates with ids
 */
export async function GET() {
  try {
    if (!process.env.SHOPIFY_SHOP_DOMAIN || !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return NextResponse.json(
        { error: "Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN env" },
        { status: 500 }
      );
    }

    const [inputShapeRes, mutationsRes, templatesRes] = await Promise.all([
      shopifyGraphQL(INTROSPECT_PAYMENT_TERMS_INPUT),
      shopifyGraphQL(LIST_MUTATIONS),
      shopifyGraphQL(LIST_TEMPLATES),
    ]);

    const inputShape = inputShapeRes?.data?.__type || null;

    const allMutations: Array<{
      name: string;
      args: Array<{ name: string; type: { kind: string; name?: string; ofType?: { kind: string; name?: string } } }>;
    }> = mutationsRes?.data?.__schema?.mutationType?.fields || [];

    // Keep only the ones we care about (names vary by shop/version)
    const mutationsSubset = allMutations.filter((m) => {
      const n = m.name || "";
      const k = n.toLowerCase();
      return k.includes("draftorder") && (k.includes("paymentterms") || k.includes("terms"));
    });

    const templates = templatesRes?.data?.paymentTermsTemplates || [];

    return NextResponse.json(
      {
        ok: true,
        version: process.env.SHOPIFY_API_VERSION || "2025-07",
        inputShape,         // <- exact fields on PaymentTermsInput for your shop
        mutations: mutationsSubset,
        templates,          // <- includes Net 30 etc with IDs
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "GraphQL inspect failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
