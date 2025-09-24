import { NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { token, server } = await lwSession();
    const res = await fetch(`${server}/api/Inventory/GetStockLocations`, {
      headers: { Authorization: token },
      cache: "no-store",
    });

    // Gracefully handle non-200s / non-JSON
    let raw: any = [];
    try { raw = await res.json(); } catch { raw = []; }

    const locations = (Array.isArray(raw) ? raw : []).map((l: any) => ({
      id:
        l?.StockLocationId ??
        l?.pkStockLocationId ??
        l?.LocationId ??
        l?.Id ??
        null,
      name: l?.LocationName ?? l?.Name ?? l?.Title ?? "Unknown",
      tag: l?.LocationTag ?? l?.Tag ?? null,
    })).filter(x => x.id);

    return NextResponse.json({ ok: true, locations });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
