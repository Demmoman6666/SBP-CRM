// app/api/shopify/variant-prices/route.ts
import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

const VAT_RATE =
  Number(process.env.NEXT_PUBLIC_VAT_RATE ?? process.env.VAT_RATE ?? "0.20");

// Parse numbers from strings like "£3.71", "3,71", MoneyV2, etc.
function parsePrice(val: any): number | null {
  if (val == null || val === "") return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "object" && (typeof val.amount === "string" || typeof val.amount === "number")) {
    return parsePrice(val.amount);
  }
  const s = String(val).trim();
  let cleaned = s.replace(/[^\d.,-]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) cleaned = cleaned.replace(/,/g, "");
  else if (cleaned.includes(",") && !cleaned.includes(".")) cleaned = cleaned.replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body?.variantIds) ? body.variantIds : [];

    const nums = Array.from(
      new Set(ids.map((x) => Number(x)).filter((n) => Number.isFinite(n)))
    );
    if (nums.length === 0) {
      return NextResponse.json({ prices: {} }, { status: 200 });
    }

    // Shopify REST: fetch variants in small batches
    const batches: number[][] = [];
    const size = 50;
    for (let i = 0; i < nums.length; i += size) batches.push(nums.slice(i, i + size));

    const out: Record<
      string,
      { priceExVat: number; productTitle?: string; variantTitle?: string; sku?: string | null }
    > = {};

    for (const batch of batches) {
      const qs = encodeURIComponent(batch.join(","));
      const res = await shopifyRest(
        `/variants.json?ids=${qs}&fields=id,price,sku,title,product_id`,
        { method: "GET" }
      );
      if (!res.ok) continue;
      const json = await res.json().catch(() => ({} as any));
      const variants: any[] = Array.isArray(json?.variants) ? json.variants : [];

      for (const v of variants) {
        const id = Number(v?.id);
        if (!Number.isFinite(id)) continue;

        const inc = parsePrice(v?.price); // Shopify prices are typically VAT-inclusive in the UK
        if (inc == null) continue;

        // Convert to ex VAT (what your cart expects)
        const ex = VAT_RATE > 0 ? inc / (1 + VAT_RATE) : inc;

        out[String(id)] = {
          priceExVat: Math.round(ex * 100) / 100,
          variantTitle: v?.title ?? undefined,
          sku: v?.sku ?? null,
        };
      }
    }

    return NextResponse.json({ prices: out });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch variant prices", prices: {} },
      { status: 500 }
    );
  }
}
