// app/api/shopify/variant-stock/route.ts
import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

// Turn any Shopify id (GID or numeric) into a number
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
    const variantIds = rawIds.map(toNumericId).filter((n): n is number => Number.isFinite(n));

    if (variantIds.length === 0) {
      return NextResponse.json({ stock: {} }, { status: 200 });
    }

    // Read inventory_quantity directly from variants (works like the price fix)
    const out: Record<string, number> = {};
    const size = 50;

    for (let i = 0; i < variantIds.length; i += size) {
      const slice = variantIds.slice(i, i + size);

      // Use ids[]=..&ids[]=.. to avoid comma-encoding quirks
      const params = new URLSearchParams();
      slice.forEach((id) => params.append("ids[]", String(id)));

      const res = await shopifyRest(
        `/variants.json?${params.toString()}&fields=id,inventory_quantity`,
        { method: "GET" }
      );
      if (!res.ok) continue;

      const json = await res.json().catch(() => ({}));
      const variants: any[] = Array.isArray(json?.variants) ? json.variants : [];

      for (const v of variants) {
        const vid = Number(v?.id);
        const qty = Number(v?.inventory_quantity);
        if (!Number.isFinite(vid)) continue;
        out[String(vid)] = Number.isFinite(qty) ? qty : 0; // keep zero when zero
      }
    }

    return NextResponse.json({ stock: out }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch variant stock", stock: {} },
      { status: 500 }
    );
  }
}
