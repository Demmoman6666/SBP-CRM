import { NextResponse } from "next/server";
import { requireShopifyEnv, shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    requireShopifyEnv();
    const res = await shopifyRest(`/locations.json`, { method: "GET" });
    if (!res.ok) throw new Error(`Shopify locations failed: ${res.status}`);
    const json = await res.json();
    const locations = (json?.locations ?? []).map((l: any) => ({
      id: String(l.id),
      name: String(l.name || "Unknown"),
      tag: l.legacy || null,
    }));
    return NextResponse.json({ ok: true, locations }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
