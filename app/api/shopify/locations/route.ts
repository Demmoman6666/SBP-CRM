import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await shopifyRest(`/locations.json`, { method: "GET" });
    const json = await res.json();
    const locations = Array.isArray(json?.locations)
      ? json.locations.map((l: any) => ({ id: String(l.id), name: l.name }))
      : [];
    return NextResponse.json({ ok: true, locations });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
