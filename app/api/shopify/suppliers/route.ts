import { NextResponse } from "next/server";
import { requireShopifyEnv, shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function nextPageInfo(linkHeader?: string | null) {
  if (!linkHeader) return null;
  const part = linkHeader.split(",").map(s => s.trim()).find(s => /rel="next"/i.test(s));
  if (!part) return null;
  const m = part.match(/<([^>]+)>/);
  if (!m) return null;
  const url = new URL(m[1]);
  return url.searchParams.get("page_info");
}

export async function GET() {
  try {
    requireShopifyEnv();

    const vendors = new Set<string>();
    let pageInfo: string | null = null;
    let guard = 0;

    do {
      const qs = new URLSearchParams({ limit: "250", fields: "id,vendor,status" });
      if (pageInfo) qs.set("page_info", pageInfo);
      const res = await shopifyRest(`/products.json?${qs.toString()}`, { method: "GET" });
      if (!res.ok) throw new Error(`Shopify products failed: ${res.status}`);
      const json = await res.json();
      (json?.products || []).forEach((p: any) => {
        const v = String(p.vendor || "").trim();
        if (v) vendors.add(v);
      });
      pageInfo = nextPageInfo(res.headers.get("link"));
      guard++;
    } while (pageInfo && guard < 40);

    const suppliers = Array.from(vendors).sort().map(v => ({ id: v, name: v }));
    return NextResponse.json({ ok: true, suppliers });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
