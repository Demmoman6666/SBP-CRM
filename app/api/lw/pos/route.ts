import { NextResponse } from "next/server";
import { getLW } from "@/lib/linnworks";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { supplierId, locationId, currency, deliveryDateISO, lines } = await req.json();
  const { token, base } = await getLW();

  const initRes = await fetch(`${base}/api/PurchaseOrder/Create_PurchaseOrder_Initial`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ supplierId, locationId, currency, deliveryDate: deliveryDateISO }),
  });
  const initTxt = await initRes.text();
  if (!initRes.ok) return NextResponse.json({ ok:false, error:"Create PO init failed", status:initRes.status, body:initTxt }, { status: 500 });

  const init = JSON.parse(initTxt); // { pkPurchaseId, ... }

  for (const line of lines) {
    const addRes = await fetch(`${base}/api/PurchaseOrder/Add_PurchaseOrderItem`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        addItemParameter: {
          pkPurchaseId: init.pkPurchaseId,
          pkStockItemId: line.stockItemId,
          Qty: line.qty,
          UnitCost: line.unitCost,
        },
      }),
    });
    if (!addRes.ok) {
      const t = await addRes.text();
      return NextResponse.json({ ok:false, error:"Add PO line failed", status:addRes.status, body:t }, { status: 500 });
    }
  }

  return NextResponse.json({ ok:true, purchaseId: init.pkPurchaseId, count: lines.length });
}
