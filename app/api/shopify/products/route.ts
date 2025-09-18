// app/api/shopify/products/route.ts
import { NextResponse } from "next/server";
import { shopifyGraphQL, gidToNumericId } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 20), 1), 50);

  if (!q) return NextResponse.json({ items: [] });

  // Build an Admin GraphQL search string
  const safe = q.replace(/"/g, '\\"');
  const query = `status:active AND (title:*${safe}* OR sku:${safe} OR vendor:*${safe}*)`;

  const gql = `
    query SearchProducts($query: String!, $first: Int!) {
      products(first: $first, query: $query) {
        edges {
          node {
            id
            title
            vendor
            featuredImage { url altText }
            variants(first: 50) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  availableForSale
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL<any>(gql, { query, first: limit });

  const items = (data?.products?.edges || []).map((e: any) => {
    const p = e.node;
    return {
      productId: gidToNumericId(p.id),
      productGid: p.id,
      title: p.title,
      vendor: p.vendor,
      image: p.featuredImage?.url || null,
      variants: (p.variants?.edges || []).map((ve: any) => {
        const v = ve.node;
        return {
          variantId: gidToNumericId(v.id),
          variantGid: v.id,
          title: v.title,
          sku: v.sku || null,
          price: Number(v.price ?? 0),
          available: !!v.availableForSale,
        };
      }),
    };
  });

  return NextResponse.json({ items });
}
