import { NextRequest, NextResponse } from "next/server";
import { requireShopifyEnv, shopifyGraphql, gidToNumericId } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Notes:
 * - variant.price -> Money (SCALAR)  ✅ no sub-selections
 * - inventoryItem.unitCost -> MoneyV2 (OBJECT)  ✅ needs { amount }
 * - inventory levels: use quantities.available and (optionally) filter by locationId
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
                  inventoryLevels(first: 100) {
                    edges {
                      node {
                        quantities { available }
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

function cleanTitle(productTitle: string, variantTitle?: string | null) {
  const vt = (variantTitle || "").trim();
  if (!vt || /^default title$/i.test(vt)) return (productTitle || "").trim();
  return `${productTitle} — ${vt}`.replace(/\s*[–—-]\s*Default Title\s*$/i, "").trim();
}

export async function GET(req: NextRequest) {
  try {
    requireShopifyEnv();

    const sp = req.nextUrl.searchParams;
    const vendor = sp.get("supplierId") || sp.get("vendor") || "";
    const limit = Math.max(1, Math.min(Number(sp.get("limit") || "800"), 2000));
    const locationId = (sp.get("locationId") || "").trim() || null; // numeric ID (from /api/shopify/locations) or empty

    if (!vendor) {
      return NextResponse.json(
        { ok: false, error: "Missing supplierId (vendor)" },
        { status: 400 }
      );
    }

    // Active products by vendor
    const query = `vendor:"${vendor.replace(/"/g, '\\"')}" status:active`;

    type OutItem = {
      sku: string;
      title: string;
      productTitle: string;
      variantId: string | null;
      priceAmount: number;
      costAmount: number;
      inventoryQuantity: number;
    };

    const items: OutItem[] = [];
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

          // Prefer per-location available if a locationId was provided; otherwise
          // use variant.inventoryQuantity (total), falling back to summed levels.
          let invQty = 0;
          const levels = (v?.inventoryItem?.inventoryLevels?.edges || []) as Array<any>;
          if (levels.length) {
            const wantedNum = locationId || null; // numeric id string
            let sum = 0;
            for (const le of levels) {
              const node = le?.node;
              const avail = Number(node?.quantities?.available ?? 0) || 0;
              const locGid = node?.location?.id || "";
              const locNum = gidToNumericId(locGid) || "";
              if (!wantedNum || wantedNum === locNum || wantedNum === locGid) {
                sum += Number.isFinite(avail) ? avail : 0;
              }
            }
            invQty = sum;
          }
          if (!locationId) {
            // when no location filter, if Shopify gave us the total variant inventory, use it
            if (typeof v?.inventoryQuantity === "number") {
              invQty = v.inventoryQuantity;
            }
          }

          items.push({
            sku,
            title: cleanTitle(productTitle, v?.title),
            productTitle,
            variantId: v?.id || null,
            priceAmount,
            costAmount,
            inventoryQuantity: Number.isFinite(invQty) ? invQty : 0,
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
