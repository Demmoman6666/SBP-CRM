import { NextResponse } from "next/server";
import { shopifyGraphql } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    type Gx = {
      products: {
        edges: Array<{ node: { productCategory?: { productTaxonomyNode?: { id: string; name?: string|null; fullName?: string|null } | null } | null } }>;
        pageInfo: { hasNextPage: boolean; endCursor?: string | null };
      };
    };
    const query = `
      query Cats($first:Int!, $after:String) {
        products(first: $first, after: $after) {
          edges {
            node {
              productCategory {
                productTaxonomyNode { id name fullName }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    const map = new Map<string, string>();
    let after: string | undefined = undefined;
    for (let i = 0; i < 10; i++) {
      const data = await shopifyGraphql<Gx>(query, { first: 200, after });
      data.products.edges.forEach(e => {
        const n = e.node.productCategory?.productTaxonomyNode;
        if (n?.id) map.set(n.id, (n.fullName || n.name || "").trim());
      });
      if (!data.products.pageInfo.hasNextPage) break;
      after = data.products.pageInfo.endCursor || undefined;
    }
    const categories = Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    return NextResponse.json({ ok: true, categories });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
