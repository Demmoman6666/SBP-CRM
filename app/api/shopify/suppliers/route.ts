import { NextRequest, NextResponse } from "next/server";
import { requireShopifyEnv, shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Extract the "page_info" cursor from Shopify REST Link header
function nextPageInfo(linkHeader?: string | null) {
  if (!linkHeader) return null;
  const nextPart = linkHeader
    .split(",")
    .map((s) => s.trim())
    .find((s) => /rel="next"/i.test(s));
  if (!nextPart) return null;
  const m = nextPart.match(/<([^>]+)>/);
  if (!m) return null;
  const url = new URL(m[1]);
  return url.searchParams.get("page_info");
}

export async function GET(req: NextRequest) {
  try {
    requireShopifyEnv();

    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") || "").trim().toLowerCase(); // optional vendor filter
    const limit = Math.max(1, Math.min(Number(sp.get("limit") || "500"), 2000)); // cap output

    // Case-insensitive dedupe; preserve first-seen display casing
    const vendorMap = new Map<string, string>(); // lower -> display

    let pageInfo: string | null = null;
    let pages = 0;

    do {
      let url: string;

      if (!pageInfo) {
        // First page: include status=active (allowed)
        const qs = new URLSearchParams({
          limit: "250",
          fields: "id,vendor,status",
          status: "active",
        });
        url = `/products.json?${qs.toString()}`;
      } else {
        // Subsequent pages: ONLY page_info (+limit) per Shopify rules
        const qs = new URLSearchParams({
          limit: "250",
          page_info: pageInfo,
        });
        url = `/products.json?${qs.toString()}`;
      }

      const res = await shopifyRest(url, { method: "GET" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Shopify products failed: ${res.status} ${text}`);
      }

      const json = await res.json();
      for (const p of json?.products ?? []) {
        const vRaw = String(p?.vendor ?? "").trim();
        if (!vRaw) continue;
        const vLower = vRaw.toLowerCase();
        if (q && !vLower.includes(q)) continue;
        if (!vendorMap.has(vLower)) vendorMap.set(vLower, vRaw);
        if (vendorMap.size >= limit) break;
      }

      if (vendorMap.size >= limit) {
        pageInfo = null;
      } else {
        pageInfo = nextPageInfo(res.headers.get("link"));
      }

      pages++;
    } while (pageInfo && pages < 80); // safety guard

    const suppliers = Array.from(vendorMap.values())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((name) => ({ id: name, name }));

    return NextResponse.json(
      { ok: true, suppliers },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
