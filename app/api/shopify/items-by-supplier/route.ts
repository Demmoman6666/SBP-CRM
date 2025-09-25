import { NextRequest, NextResponse } from "next/server";
import { requireShopifyEnv, shopifyGraphql } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Your schema specifics:
 * - variant.price -> Money (SCALAR)  ✅ no sub-selections
 * - inventoryItem.unitCost -> MoneyV2 (OBJECT)  ✅ needs { amount ... }
 */
const QUERY = /* GraphQL */ `
  query ProductsByVendor($query: String!, $cursor: String) {
    products(first: 50, query: $query, after: $cursor) {
      edges {
        cursor
        node {
          id
          title
          vendor
          status
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                inventoryQuantity
                price
                inventoryItem {
                  unitCost { amount }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function cleanTitle(productTitle: string, variantTitle?: string | null) {
  const vt = (variantTitle || "").trim();
  if (!vt || /^default title$/i.test(vt)) return (productTitle || "").trim();
  return `${productTitle} — ${vt}`.replace(/\s*[–—-]\s*Default Title\s*$/i, "").trim();
}

export async function GET(req: NextRequest) {
  try {
    requireShopifyEnv();

    const sp = req.nextUrl.searchParams;
    const vendor =
      sp.get("supplierId") ||
      sp.get("vendor") ||
      "";
    const limit = Math.max(1, Math.min(Number(sp.get("limit") || "800"), 2000));

    if (!vendor) {
      return NextResponse.json(
        { ok: false, error: "Missing supplierId (vendor)" },
        { status: 400 }
      );
    }

    // Active products by vendor
    const query = `vendor:"${vendor.replace(/"/g, '\\"')}" status:active`;

    const items: Array<{
      sku: string;
      title: string;
      productTitle: string;
      variantId: string | null;
      priceAmount: number;     // scalar Money parsed to number
      costAmount: number;      // MoneyV2.amount parsed to number
      inventoryQuantity: number;
    }> = [];

    let cursor: string | null = null;
    let count = 0;

    while (count < limit) {
      const data: any = await shopifyGraphql(QUERY, { query, cursor });

      const edges = data?.products?.edges || [];
      for (const e of edges) {
        const p = e?.node;
        const productTitle = (p?.title || "").trim();

        const vEdges = p?.variants?.edges || [];
        for (const ve of vEdges) {
          const v = ve?.node;
          const sku = String(v?.sku || "").trim();
          if (!sku) continue;

          // price is a scalar Money in your shop
          const priceAmount = Number(v?.price ?? 0) || 0;
          // unitCost is MoneyV2 -> { amount }
          const costAmount = Number(v?.inventoryItem?.unitCost?.amount ?? 0) || 0;

          const inventoryQuantity =
            typeof v?.inventoryQuantity === "number" ? v.inventoryQuantity : 0;

          items.push({
            sku,
            title: cleanTitle(productTitle, v?.title),
            productTitle,
            variantId: v?.id || null,
            priceAmount,
            costAmount,
            inventoryQuantity,
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

    return NextResponse.json(
      { ok: true, items, source: "ShopifyProducts" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
