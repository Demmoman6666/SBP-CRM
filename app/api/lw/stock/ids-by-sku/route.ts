import { NextResponse } from "next/server";
import { getLW } from "@/lib/linnworks";
export const dynamic = "force-dynamic";

// body: { skus: string[] }
export async function POST(req: Request) {
  const { skus } = await req.json();
  const { token, host } = await getLW();
  const r = await fetch(`https://${host}/api/Inventory/GetStockItemIdsBySKU`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ skus }),
    cache: "no-store",
  });
  return NextResponse.json(await r.json());
}
