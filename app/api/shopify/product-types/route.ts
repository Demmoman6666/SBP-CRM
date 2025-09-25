import { NextResponse } from "next/server";
import { shopifyGraphql } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    type Gx = {
      products: {
        edges: Array<{ node: { productType?: string | null } }>;
        pageInfo: { hasNextPage: boolean; endCursor?: string | null };
      };
    };
    const query = `
      query Types($first:Int!, $after:String) {
        products(first: $first, after: $after) {
          edges { node { productType } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    const s = new Set<string>();
    let after: string | undefined = undefined;
    for (let i = 0; i < 10; i++) {
      const data = await shopifyGraphql<Gx>(query, { first: 200, after });
      data.products.edges.forEach(e => {
        const t = (e.node.productType || "").trim();
        if (t) s.add(t);
      });
      if (!data.products.pageInfo.hasNextPage) break;
      after = data.products.pageInfo.endCursor || undefined;
    }
    const types = Array.from(s).sort().map(name => ({ name }));
    return NextResponse.json({ ok: true, types });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
