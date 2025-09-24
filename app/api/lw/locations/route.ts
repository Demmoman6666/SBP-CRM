import { NextResponse } from "next/server";
import { getLW } from "@/lib/linnworks";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { token, host } = await getLW();
    const r = await fetch(`https://${host}/api/Inventory/GetStockLocations`, {
      headers: { Authorization: token },
      cache: "no-store",
    });
    const txt = await r.text();
    if (!r.ok) {
      return NextResponse.json({ error: "LW locations failed", status: r.status, body: txt }, { status: 500 });
    }
    return NextResponse.json({ locations: JSON.parse(txt) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "LW locations error" }, { status: 500 });
  }
}
