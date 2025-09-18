// app/api/shopify/products/route.ts
import { NextResponse } from "next/server";
import { shopifyGraphql, gidToNumericId, shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function qString(term: string) {
  const t = term.replace(/"/g, '\\"').trim();
  if (!t) return "";
  return `title:*${t}* OR sku:*${t}* OR vendor:*${t}*`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const term = (searchParams.get("q") || "").trim();
  const first = Number(searchParams.get("first") || 15);

  if (!term) return NextResponse.json([], { status: 200 });

  // Admin GraphQL: variant.price is a scalar Money (string), not MoneyV2.
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
                  price
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
      products: {
        edges: Array<{
          node: {
            id: string;
            title: string;
            vendor?: string | null;
            status?: string | null;
            images?: { edges: Array<{ node: { url: string } }> } | null;
            variants: {
              edges: Array<{
                node: {
                  id: string;
                  title: string;
                  sku?: string | null;
                  barcode?: string | null;
                  availableForSale?: boolean | null;
                  inventoryQuantity?: number | null;
                  price: string | null;
                };
              }>;
            };
          };
        }>;
      };
    }>(query, { q: qString(term), first });

    const products = (data?.products?.edges || []).map((pe) => {
      const p = pe.node;
      const img = p.images?.edges?.[0]?.node?.url ?? null;

      return {
        id: gidToNumericId(p.id) || p.id,
        title: p.title,
        vendor: p.vendor ?? null,
        status: p.status ?? null,
        image: img ? { src: img } : null,
        variants: (p.variants?.edges || []).map((ve) => {
          const v = ve.node;
          return {
            id: gidToNumericId(v.id) || v.id,
            title: v.title,
            price: v.price ?? null, // scalar string from Admin API
            sku: v.sku ?? null,
            available: v.availableForSale ?? true,
            stock: typeof v.inventoryQuantity === "number" ? v.inventoryQuantity : null, // ✅ expose live stock
            barcode: v.barcode ?? null,
          };
        }),
      };
    });

    return NextResponse.json(products, { status: 200 });
  } catch (err) {
    console.error("GraphQL search failed, falling back to REST:", err);
    try {
      // Very basic fallback (title match only)
      const res = await shopifyRest(
        `/products.json?title=${encodeURIComponent(term)}&limit=10`,
        { method: "GET" }
      );
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
        vendor: p.vendor ?? null,
        status: p.status ?? null,
        image: p?.image?.src ? { src: p.image.src } : null,
        variants: (p.variants || []).map((v: any) => ({
          id: String(v.id),
          title: v.title,
          price: v.price ?? v.compare_at_price ?? null,
          sku: v.sku ?? null,
          available:
            typeof v.inventory_quantity === "number"
              ? v.inventory_quantity > 0
              : true,
          stock:
            typeof v.inventory_quantity === "number"
              ? v.inventory_quantity
              : null,
          barcode: v.barcode ?? null,
        })),
      }));
      return NextResponse.json(products, { status: 200 });
    } catch (fallbackErr) {
      console.error("Product search fallback failed:", fallbackErr);
      return NextResponse.json(
        { error: "Shopify product search failed (GraphQL and REST)" },
        { status: 500 }
      );
    }
  }
}
