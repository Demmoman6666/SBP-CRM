import { NextResponse } from "next/server";
import { requireShopifyEnv, shopifyGraphql } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const QUERY = /* GraphQL */ `
  query Cats($cursor: String) {
    products(first: 100, query: "status:active", after: $cursor) {
      edges {
        cursor
        node {
          productCategory {
            productTaxonomyNode { id fullName }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function GET() {
  try {
    requireShopifyEnv();

    const catMap = new Map<string, string>(); // id -> fullName
    let cursor: string | null = null;
    let pages = 0;

    do {
      const data: any = await shopifyGraphql(QUERY, { cursor });
      for (const e of data?.products?.edges ?? []) {
        const node = e?.node?.productCategory?.productTaxonomyNode;
        if (node?.id && node?.fullName) catMap.set(node.id, node.fullName);
      }
      const pi = data?.products?.pageInfo;
      cursor = pi?.hasNextPage ? pi.endCursor : null;
      pages++;
    } while (cursor && pages < 50);

    const categories = Array.from(catMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ id, name }));

    return NextResponse.json({ ok: true, categories }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
