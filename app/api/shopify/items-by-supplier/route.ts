import { NextRequest, NextResponse } from "next/server";
import { requireShopifyEnv, shopifyGraphql } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const QUERY = /* GraphQL */ `
  query ProductsByVendor($query: String!, $cursor: String) {
    products(first: 100, query: $query, after: $cursor) {
      edges {
        cursor
        node {
          id
          title
          vendor
          variants(first: 100) {
            edges {
              node { id sku title }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function GET(req: NextRequest) {
  try {
    requireShopifyEnv();
    const vendor =
      req.nextUrl.searchParams.get("supplierId") ||
      req.nextUrl.searchParams.get("vendor") ||
      "";
    const limit = Number(req.nextUrl.searchParams.get("limit") || "800");
    if (!vendor) return NextResponse.json({ ok: false, error: "Missing supplierId (vendor)" }, { status: 400 });

    const query = `vendor:"${vendor.replace(/"/g, '\\"')}" status:active`;
    let cursor: string | null = null;
    const items: any[] = [];
    let count = 0;

    while (count < limit) {
      const data: any = await shopifyGraphql(QUERY, { query, cursor });
      const edges = data?.products?.edges || [];
      for (const e of edges) {
        const p = e.node;
        const title = p?.title || "";
        const vEdges = p?.variants?.edges || [];
        for (const ve of vEdges) {
          const v = ve.node;
          const sku = String(v?.sku || "").trim();
          if (!sku) continue;
          items.push({
            sku,
            title: `${title} — ${v?.title || ""}`.trim(),
            variantId: v?.id,
            productTitle: title,
          });
          count++;
          if (count >= limit) break;
        }
        if (count >= limit) break;
      }
      const hasNext = data?.products?.pageInfo?.hasNextPage;
      cursor = hasNext ? data?.products?.pageInfo?.endCursor : null;
      if (!hasNext) break;
    }

    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
