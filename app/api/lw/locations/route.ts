import { NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { token, server } = await lwSession();
    const r = await fetch(`${server}/api/Inventory/GetStockLocations`, {
      headers: { Authorization: token, Accept: "application/json" },
      cache: "no-store",
    });

    const text = await r.text();
    if (!r.ok) return NextResponse.json({ ok:false, error:"LW GetStockLocations failed", status:r.status, body:text }, { status: 500 });

    const raw = JSON.parse(text);
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.Data) ? raw.Data : [];
    const locations = arr.map((l: any) => ({
      id: l?.StockLocationId ?? l?.pkStockLocationId ?? l?.LocationId ?? l?.Id,
      name: l?.LocationName ?? l?.Name ?? l?.Title ?? "Unknown",
      tag: l?.LocationTag ?? l?.Tag ?? null,
    })).filter((x: any) => x?.id);

    return NextResponse.json({ ok: true, locations });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error: e?.message || "LW locations error" }, { status: 500 });
  }
}
