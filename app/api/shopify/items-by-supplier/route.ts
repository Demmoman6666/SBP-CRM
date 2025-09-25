import { NextRequest, NextResponse } from "next/server";
import { requireShopifyEnv, shopifyGraphql } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
                price { amount currencyCode }
                inventoryQuantity
                inventoryItem {
                  unitCost { amount currencyCode }
                  inventoryLevels(first: 100) {
                    edges {
                      node {
                        available
                        location { id name }
                      }
                    }
                  }
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

function cleanTitle(prodTitle: string, varTitle?: string | null) {
  const vt = (varTitle || "").trim();
  let t = prodTitle || "";
  if (vt && vt.toLowerCase() !== "default title") t += ` — ${vt}`;
  return t;
}

export async function GET(req: NextRequest) {
  try {
    requireShopifyEnv();

    const vendor =
      req.nextUrl.searchParams.get("supplierId") ||
      req.nextUrl.searchParams.get("vendor") || "";
    const limit = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get("limit") || "800"), 2000));
    const locationId = req.nextUrl.searchParams.get("locationId") || "";

    if (!vendor) return NextResponse.json({ ok: false, error: "Missing supplierId (vendor)" }, { status: 400 });

    const query = `vendor:"${vendor.replace(/"/g, '\\"')}" status:active`;
    const items: any[] = [];
    let cursor: string | null = null;
    let count = 0;

    while (count < limit) {
      const data: any = await shopifyGraphql(QUERY, { query, cursor });
      const edges = data?.products?.edges || [];
      for (const e of edges) {
        const p = e.node;
        const pTitle = p?.title || "";
        const vEdges = p?.variants?.edges || [];
        for (const ve of vEdges) {
          const v = ve.node;
          const sku = String(v?.sku || "").trim();
          if (!sku) continue;

          // derive cost & stock
          const cost = Number(v?.inventoryItem?.unitCost?.amount ?? 0) || 0;
          const price = Number(v?.price?.amount ?? 0) || 0;

          // total stock (Shopify’s quick field)
          let totalStock = typeof v?.inventoryQuantity === "number" ? v.inventoryQuantity : 0;

          // more accurate by location (fallback/override)
          const levels = v?.inventoryItem?.inventoryLevels?.edges ?? [];
          const byLoc: Record<string, number> = {};
          for (const le of levels) {
            const lvl = le?.node;
            if (!lvl?.location?.id) continue;
            const lid = String(lvl.location.id).replace(/^gid:\/\/shopify\/Location\//, "");
            const avail = Number(lvl.available ?? 0) || 0;
            byLoc[lid] = (byLoc[lid] || 0) + avail;
          }
          if (Object.keys(byLoc).length) {
            totalStock = Object.values(byLoc).reduce((a, b) => a + b, 0);
          }
          const stockForSelected = locationId ? (byLoc[locationId] ?? 0) : totalStock;

          items.push({
            sku,
            title: cleanTitle(pTitle, v?.title),
            productTitle: pTitle,
            variantId: v?.id || null,
            priceAmount: price,
            costAmount: cost,
            inventoryQuantity: stockForSelected,
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

    return NextResponse.json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
