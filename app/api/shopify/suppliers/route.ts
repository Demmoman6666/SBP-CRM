import { NextRequest, NextResponse } from "next/server";
import { requireShopifyEnv, shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Parse "page_info" from Shopify REST Link header for cursor pagination
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
    const q = (sp.get("q") || "").trim().toLowerCase(); // optional vendor name filter
    const limit = Math.max(1, Math.min(Number(sp.get("limit") || "500"), 2000)); // cap output

    // We’ll iterate active products only to avoid retired vendors.
    let pageInfo: string | null = null;
    let pagesScanned = 0;

    // Deduplicate vendors case-insensitively but keep the first-seen display casing.
    const vendorMap = new Map<string, string>(); // lower -> display

    do {
      const qs = new URLSearchParams({
        limit: "250",
        fields: "id,vendor,status",
        status: "active",
      });
      if (pageInfo) qs.set("page_info", pageInfo);

      const res = await shopifyRest(`/products.json?${qs.toString()}`, { method: "GET" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Shopify products failed: ${res.status} ${text}`);
      }
      const json = await res.json();

      for (const p of json?.products ?? []) {
        const vRaw = String(p?.vendor ?? "").trim();
        if (!vRaw) continue;
        const vLower = vRaw.toLowerCase();

        // Optional search filter
        if (q && !vLower.includes(q)) continue;

        if (!vendorMap.has(vLower)) vendorMap.set(vLower, vRaw);
        if (vendorMap.size >= limit) break;
      }

      pageInfo = vendorMap.size >= limit ? null : nextPageInfo(res.headers.get("link"));
      pagesScanned++;
    } while (pageInfo && pagesScanned < 80); // hard guard

    const suppliers = Array.from(vendorMap.values())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((name) => ({ id: name, name }));

    return new NextResponse(JSON.stringify({ ok: true, suppliers }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
