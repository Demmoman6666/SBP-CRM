import { NextResponse } from "next/server";
import { getLW } from "@/lib/linnworks";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { token, base } = await getLW();
    const r = await fetch(`${base}/api/Inventory/GetStockLocations`, {
      headers: { Authorization: token, Accept: "application/json" },
      cache: "no-store",
    });
    const text = await r.text();
    if (!r.ok) return NextResponse.json({ ok:false, error:"LW GetStockLocations failed", status:r.status, body:text }, { status: 500 });

    const raw = JSON.parse(text);
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.Data) ? raw.Data : [];
    const locations = arr.map((s: any) => ({
      LocationId: s.LocationId ?? s.Id ?? s.pkStockLocationId ?? s.pkStockLocationID,
      LocationName: s.LocationName ?? s.Name ?? s.Title ?? "Unknown",
      IsDefault: Boolean(s.IsDefault ?? s.Default ?? false),
    })).filter((x: any) => x.LocationId);

    return NextResponse.json({ ok:true, locations });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error: e?.message || "LW locations error" }, { status: 500 });
  }
}
