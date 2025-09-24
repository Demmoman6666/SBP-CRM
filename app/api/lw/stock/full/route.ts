import { NextResponse } from "next/server";
import { getLW } from "@/lib/linnworks";
export const dynamic = "force-dynamic";

// body: { stockItemIds: string[], withSuppliers?: boolean }
export async function POST(req: Request) {
  const { stockItemIds, withSuppliers = true } = await req.json();
  const { token, host } = await getLW();
  const body = {
    request: {
      StockItemIds: stockItemIds,
      DataRequirements: withSuppliers ? ["StockLevels", "Supplier"] : ["StockLevels"],
    },
  };
  const r = await fetch(`https://${host}/api/Stock/GetStockItemsFullByIds`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return NextResponse.json(await r.json());
}
