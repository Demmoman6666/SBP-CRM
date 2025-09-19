// app/api/shopify/variant-prices/route.ts
import { NextResponse } from "next/server";
import { shopifyGraphql } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PostBody = {
  variantIds: Array<number | string>;
};

// Mirrors the query you already use elsewhere so types stay consistent.
const QUERY = `
  query VariantPrices($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        price
        sku
        product { title }
      }
    }
  }
`;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PostBody | null;
    const rawIds = (body?.variantIds ?? []).map((v) => String(v)).filter(Boolean);
    if (!rawIds.length) {
      return NextResponse.json({ prices: {} }, { status: 200 });
    }

    // Convert to Shopify GIDs
    const gids = rawIds.map((id) => `gid://shopify/ProductVariant/${id}`);

    const data = await shopifyGraphql<{
      nodes: Array<
        | {
            __typename?: "ProductVariant";
            id: string;
            title: string;
            price: string | null;
            sku?: string | null;
            product: { title: string };
          }
        | null
      >;
    }>(QUERY, { ids: gids });

    // Return as a map keyed by numeric variantId
    const out: Record<
      string,
      { priceExVat: number; productTitle: string; variantTitle: string; sku?: string | null }
    > = {};

    for (const node of data.nodes || []) {
      if (!node || !("id" in node)) continue;
      const restId = node.id.replace(/^gid:\/\/shopify\/ProductVariant\//, "");
      const price = Number(node.price || "0");
      out[restId] = {
        priceExVat: Number.isFinite(price) ? price : 0,
        productTitle: node.product?.title ?? "Product",
        variantTitle: node.title ?? "",
        sku: node.sku ?? null,
      };
    }

    return NextResponse.json({ prices: out }, { status: 200 });
  } catch (err: any) {
    console.error("variant-prices error:", err);
    return NextResponse.json({ error: err?.message || "variant-prices failed" }, { status: 500 });
  }
}
