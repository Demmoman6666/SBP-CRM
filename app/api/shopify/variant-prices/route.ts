import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

const VAT_RATE = Number(process.env.VAT_RATE ?? process.env.NEXT_PUBLIC_VAT_RATE ?? "0.20");

// Robustly turn any Shopify id (GID or numeric) into a number
function toNumericId(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v);
  const m = s.match(/(\d+)(?!.*\d)/); // last run of digits
  return m ? Number(m[1]) : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawIds: any[] = Array.isArray(body?.ids) ? body.ids : [];
    const ids = rawIds.map(toNumericId).filter((n): n is number => Number.isFinite(n));

    if (ids.length === 0) {
      return NextResponse.json({ prices: {} }, { status: 200 });
    }

    // Fetch variants in small batches
    const out: Record<
      string,
      { priceExVat: number; variantTitle?: string | null; sku?: string | null }
    > = {};
    const size = 50;
    for (let i = 0; i < ids.length; i += size) {
      const slice = ids.slice(i, i + size);
      const qs = encodeURIComponent(slice.join(","));
      const res = await shopifyRest(
        `/variants.json?ids=${qs}&fields=id,price,sku,title`,
        { method: "GET" }
      );
      if (!res.ok) continue;

      const json = await res.json().catch(() => ({}));
      const variants: any[] = Array.isArray(json?.variants) ? json.variants : [];

      for (const v of variants) {
        const inc = Number(v?.price);
        if (!Number.isFinite(inc)) continue;

        // Convert to ex VAT (Shopify store prices are typically VAT-inclusive in the UK)
        const ex = inc / (1 + VAT_RATE);
        const key = String(v?.id);
        out[key] = {
          priceExVat: Math.round(ex * 100) / 100,
          variantTitle: v?.title ?? null,
          sku: v?.sku ?? null,
        };
      }
    }

    return NextResponse.json({ prices: out }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch variant prices", prices: {} },
      { status: 500 }
    );
  }
}
