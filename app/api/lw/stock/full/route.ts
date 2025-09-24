import { NextResponse } from "next/server";
import { getLW } from "@/lib/linnworks";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { stockItemIds, withSuppliers = true } = await req.json();
  const { token, base } = await getLW();
  const body = {
    request: {
      StockItemIds: stockItemIds,
      DataRequirements: withSuppliers ? ["StockLevels", "Supplier"] : ["StockLevels"],
    },
  };
  const r = await fetch(`${base}/api/Stock/GetStockItemsFullByIds`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await r.text();
  if (!r.ok) return NextResponse.json({ ok:false, error:"LW stock/full failed", status:r.status, body:text }, { status: 500 });
  return NextResponse.json(JSON.parse(text));
}
