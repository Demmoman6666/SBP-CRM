import { NextRequest, NextResponse } from "next/server";
import { requireShopifyEnv, shopifyGraphql, gidToNumericId } from "@/lib/shopify";

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
          productType
          productCategory { productTaxonomyNode { id name fullName } }
          variants(first: 100) {
            edges {
              node {
                id
                sku
                title
                inventoryQuantity
                price { amount }
                inventoryItem { unitCost { amount } }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function stripDefaultTitle(s: string) {
  return s.replace(/\s*[–—-]\s*Default Title\s*$/i, "").trim();
}

export async function GET(req: NextRequest) {
  try {
    requireShopifyEnv();

    const sp = req.nextUrl.searchParams;
    const vendor =
      sp.get("supplierId") ||
      sp.get("vendor") ||
      "";
    const limit = Math.min(Number(sp.get("limit") || "800"), 1000);

    // Optional filters pulled from the querystring:
    const productType = (sp.get("productType") || "").trim();
    const productCategoryId = (sp.get("productCategoryId") || "").trim(); // taxonomy node id (gid)
    const collectionIdRaw = (sp.get("collectionId") || "").trim();       // gid or numeric
    const collectionNumeric = collectionIdRaw
      ? (/^\d+$/.test(collectionIdRaw) ? collectionIdRaw : (gidToNumericId(collectionIdRaw) || ""))
      : "";

    if (!vendor) {
      return NextResponse.json(
        { ok: false, error: "Missing supplierId (vendor)" },
        { status: 400 }
      );
    }

    // Build Shopify Admin search query
    // See https://shopify.dev/docs/api/admin-graphql for product search syntax.
    const parts: string[] = [];
    parts.push(`vendor:"${vendor.replace(/"/g, '\\"')}"`);
    parts.push(`status:active`);
    if (productType) parts.push(`product_type:"${productType.replace(/"/g, '\\"')}"`);
    if (collectionNumeric) parts.push(`collection_id:${collectionNumeric}`);
    const query = parts.join(" ");

    let cursor: string | null = null;
    const items: Array<{
      sku: string;
      title: string;
      variantId: string;
      productTitle: string;
      cost: number;
      inventoryQuantity: number;
    }> = [];

    while (items.length < limit) {
      const data: any = await shopifyGraphql(QUERY, { query, cursor });
      const edges = data?.products?.edges || [];

      for (const e of edges) {
        const p = e.node as {
          title: string;
          productCategory?: { productTaxonomyNode?: { id: string } | null } | null;
          variants: { edges: Array<{ node: any }> };
        };

        // If productCategoryId filter provided, enforce it client-side
        if (productCategoryId) {
          const catId = p?.productCategory?.productTaxonomyNode?.id || "";
          if (!catId || catId !== productCategoryId) continue;
        }

        const productTitle = (p?.title || "").trim();

        for (const ve of p?.variants?.edges || []) {
          const v = ve.node as {
            id: string;
            sku?: string | null;
            title?: string | null;
            inventoryQuantity?: number | null;
            price?: { amount?: string | null } | null;
            inventoryItem?: { unitCost?: { amount?: string | null } | null } | null;
          };

          const sku = String(v?.sku || "").trim();
          if (!sku) continue;

          const vTitle = (v?.title || "").trim();
          const needsVariant =
            vTitle &&
            !/^(default title)$/i.test(vTitle) &&
            vTitle.toLowerCase() !== productTitle.toLowerCase();

          const combinedTitle = needsVariant ? `${productTitle} — ${vTitle}` : productTitle;
          const cleanTitle = stripDefaultTitle(combinedTitle);

          // Prefer unit cost; fall back to variant price if missing
          const cost =
            Number(v?.inventoryItem?.unitCost?.amount ?? "") ||
            Number(v?.price?.amount ?? "") ||
            0;

          const stock =
            typeof v?.inventoryQuantity === "number" ? v.inventoryQuantity : 0;

          items.push({
            sku,
            title: cleanTitle,
            variantId: String(v?.id || ""),
            productTitle,
            cost,
            inventoryQuantity: stock,
          });

          if (items.length >= limit) break;
        }
        if (items.length >= limit) break;
      }

      const hasNext = data?.products?.pageInfo?.hasNextPage;
      cursor = hasNext ? data?.products?.pageInfo?.endCursor || null : null;
      if (!hasNext) break;
    }

    return NextResponse.json({ ok: true, items, source: "ShopifyProducts" });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
