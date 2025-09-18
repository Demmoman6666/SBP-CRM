// app/api/shopify/products/route.ts
import { NextResponse } from "next/server";
import { searchShopifyCatalog } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/shopify/products?q=term
 * Returns:
 * [
 *   {
 *     id: "123456789",             // product id (numeric string)
 *     title: "Product title",
 *     image: { src: "https://..." },
 *     variants: [
 *       {
 *         id: "987654321",         // variant id (numeric string)
 *         title: "Default Title",
 *         price: "12.34",
 *         sku: "ABC-123",
 *         available: true
 *       }
 *     ]
 *   }
 * ]
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    if (!q) return NextResponse.json([]);

    // Use the helper we added in lib/shopify.ts
    const variants = await searchShopifyCatalog(q, 20);

    // Group variants by product
    const byProduct = new Map<
      string,
      {
        id: string;
        title: string;
        image?: { src?: string | null } | null;
        variants: Array<{
          id: string;
          title: string;
          price?: string | number | null;
          sku?: string | null;
          available?: boolean;
        }>;
      }
    >();

    for (const v of variants) {
      const pid = v.productId || v.productGid || "unknown";
      if (!byProduct.has(pid)) {
        byProduct.set(pid, {
          id: pid,
          title: v.productTitle,
          image: v.imageUrl ? { src: v.imageUrl } : null, // <-- matches your client mapping
          variants: [],
        });
      }
      const group = byProduct.get(pid)!;
      group.variants.push({
        id: v.variantId || v.variantGid || "",
        title: v.variantTitle,
        price: v.priceAmount,            // your client handles string/number/null
        sku: v.sku ?? null,
        available: v.availableForSale ?? true,
      });
    }

    return NextResponse.json(Array.from(byProduct.values()));
  } catch (err: any) {
    console.error("Product search failed:", err);
    return NextResponse.json(
      { error: err?.message || "Shopify product search failed" },
      { status: 500 }
    );
  }
}
