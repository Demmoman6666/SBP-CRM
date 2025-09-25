// app/api/shopify/oos-days-by-sku/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { skus = [], days = 60 } = await req.json().catch(() => ({}));
    const out: Record<string, number> = {};
    for (const s of skus) out[s] = 0; // default until snapshots are wired
    return NextResponse.json({ ok: true, days: out, window: Number(days) || 60, source: "none" });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
