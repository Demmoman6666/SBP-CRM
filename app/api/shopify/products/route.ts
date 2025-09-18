// app/api/shopify/products/route.ts
import { NextResponse } from "next/server";
import { shopifyGraphql, gidToNumericId, shopifyRest, SHOPIFY_API_VERSION } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function qString(term: string) {
  const t = term.replace(/"/g, '\\"').trim();
  if (!t) return "";
  // Search title, sku, vendor using Shopify's product query syntax
  // Doc example: title:'my title' vendor:'Acme' sku:'ABC'
  // Wildcard is supported with *; we wrap to catch partials.
  return `title:*${t}* OR sku:*${t}* OR vendor:*${t}*`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const term = (searchParams.get("q") || "").trim();
  if (!term) return NextResponse.json([], { status: 200 });

  // ---- GraphQL search (preferred; supports sku/vendor properly)
  const query = `
    query SearchProducts($q: String!, $first: Int!) {
      products(first: $first, query: $q) {
        edges {
          node {
            id
            title
            vendor
            status
            images(first: 1) { edges { node { url } } }
            variants(first: 50) {
              edges {
                node {
                  id
                  title
                  sku
                  barcode
                  availableForSale
                  inventoryQuantity
                  price { amount currencyCode }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const data = await shopifyGraphql<{
      products: { edges: Array<{
        node: {
          id: string; title: string; vendor?: string | null; status?: string | null;
          images?: { edges: { node: { url: string } }[] } | null;
          variants: { edges: Array<{ node: {
            id: string; title: string; sku?: string | null; barcode?: string | null;
            availableForSale?: boolean | null; inventoryQuantity?: number | null;
            price?: { amount: string; currencyCode: string } | null;
          }}>};
        }
      }> }
    }>(query, { q: qString(term), first: 15 });

    const products: any[] = [];

    for (const pe of data?.products?.edges || []) {
      const p = pe.node;
      const productId = gidToNumericId(p.id) || p.id;
      const img = p.images?.edges?.[0]?.node?.url ?? null;

      const variants = (p.variants?.edges || []).map((ve) => {
        const v = ve.node;
        return {
          id: gidToNumericId(v.id) || v.id,
          title: v.title,
          price: v.price?.amount ?? null,
          sku: v.sku ?? null,
          available: v.availableForSale ?? true,
        };
      });

      products.push({
        id: productId,
        title: p.title,
        image: img ? { src: img } : null,
        variants,
      });
    }

    return NextResponse.json(products, { status: 200 });
  } catch (err) {
    // ---- Fallback to REST (very basic title match) so you still get something
    console.error("GraphQL search failed, falling back to REST:", err);
    try {
      const res = await shopifyRest(`/products.json?title=${encodeURIComponent(term)}&limit=10`, { method: "GET" });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return NextResponse.json(
          { error: `Shopify REST search failed: ${res.status} ${txt}` },
          { status: 500 }
        );
      }
      const json = await res.json();
      const products = (json?.products || []).map((p: any) => ({
        id: String(p.id),
        title: p.title,
        image: p?.image?.src ? { src: p.image.src } : null,
        variants: (p.variants || []).map((v: any) => ({
          id: String(v.id),
          title: v.title,
          price: v.price ?? v.compare_at_price ?? null,
          sku: v.sku ?? null,
          available: true,
        })),
      }));
      return NextResponse.json(products, { status: 200 });
    } catch (e2) {
      console.error("Product search fallback failed:", e2);
      return NextResponse.json(
        { error: "Shopify product search failed (GraphQL and REST)" },
        { status: 500 }
      );
    }
  }
}
