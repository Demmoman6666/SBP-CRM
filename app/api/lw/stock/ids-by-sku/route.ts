import { NextResponse } from "next/server";
import { getLW } from "@/lib/linnworks";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { skus } = await req.json();
  const { token, base } = await getLW();
  const r = await fetch(`${base}/api/Inventory/GetStockItemIdsBySKU`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ skus }),
    cache: "no-store",
  });
  const text = await r.text();
  if (!r.ok) return NextResponse.json({ ok:false, error:"LW ids-by-sku failed", status:r.status, body:text }, { status: 500 });
  return NextResponse.json(JSON.parse(text));
}
