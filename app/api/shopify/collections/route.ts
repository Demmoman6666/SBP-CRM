import { NextResponse } from "next/server";
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

async function fetchAll(pathBase: "/custom_collections.json" | "/smart_collections.json") {
  const out: any[] = [];
  let pageInfo: string | null = null;
  let pages = 0;

  do {
    const path = pageInfo
      ? `${pathBase}?${new URLSearchParams({ limit: "250", page_info: pageInfo }).toString()}`
      : `${pathBase}?${new URLSearchParams({ limit: "250" }).toString()}`;
    const res = await shopifyRest(path, { method: "GET" });
    if (!res.ok) throw new Error(`Shopify ${pathBase} failed: ${res.status}`);
    const json = await res.json();
    out.push(...(json?.custom_collections ?? json?.smart_collections ?? []));
    pageInfo = nextPageInfo(res.headers.get("link"));
    pages++;
  } while (pageInfo && pages < 80);

  return out;
}

export async function GET() {
  try {
    requireShopifyEnv();
    const [customs, smarts] = await Promise.all([
      fetchAll("/custom_collections.json"),
      fetchAll("/smart_collections.json"),
    ]);

    const map = new Map<string, { id: string; name: string; handle?: string }>();
    for (const c of [...customs, ...smarts]) {
      const id = String(c.id);
      const name = String(c.title || "Untitled");
      if (!map.has(id)) map.set(id, { id, name, handle: c.handle || undefined });
    }

    const collections = Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );

    return NextResponse.json({ ok: true, collections }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
