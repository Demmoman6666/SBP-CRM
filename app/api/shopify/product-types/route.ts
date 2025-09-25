import { NextRequest, NextResponse } from "next/server";
import { requireShopifyEnv, shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function nextPageInfo(linkHeader?: string | null) {
  if (!linkHeader) return null;
  const next = linkHeader.split(",").map(s => s.trim()).find(s => /rel="next"/i.test(s));
  if (!next) return null;
  const m = next.match(/<([^>]+)>/);
  if (!m) return null;
  const url = new URL(m[1]);
  return url.searchParams.get("page_info");
}

export async function GET(req: NextRequest) {
  try {
    requireShopifyEnv();

    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(Number(sp.get("limit") || "500"), 5000));

    const typeMap = new Map<string, string>();
    let pageInfo: string | null = null;
    let pages = 0;

    do {
      let path: string;
      if (!pageInfo) {
        const qs = new URLSearchParams({ limit: "250", fields: "id,product_type,status", status: "active" });
        path = `/products.json?${qs.toString()}`;
      } else {
        const qs = new URLSearchParams({ limit: "250", page_info: pageInfo });
        path = `/products.json?${qs.toString()}`;
      }
      const res = await shopifyRest(path, { method: "GET" });
      if (!res.ok) throw new Error(`Shopify products failed: ${res.status}`);
      const json = await res.json();

      for (const p of json?.products ?? []) {
        const raw = String(p?.product_type ?? "").trim();
        if (!raw) continue;
        const lower = raw.toLowerCase();
        if (q && !lower.includes(q)) continue;
        if (!typeMap.has(lower)) typeMap.set(lower, raw);
        if (typeMap.size >= limit) break;
      }

      if (typeMap.size >= limit) break;
      pageInfo = nextPageInfo(res.headers.get("link"));
      pages++;
    } while (pageInfo && pages < 80);

    const productTypes = Array.from(typeMap.values())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map(name => ({ id: name, name }));

    return NextResponse.json({ ok: true, productTypes }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
