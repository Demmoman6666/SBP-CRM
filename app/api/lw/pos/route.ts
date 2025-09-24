import { NextResponse } from 'next/server';
import { getLW } from '@/lib/linnworks';
export const dynamic = 'force-dynamic';

// body: { supplierId, locationId, currency, deliveryDateISO, lines:[{ stockItemId, qty, unitCost }] }
export async function POST(req: Request) {
  const { supplierId, locationId, currency, deliveryDateISO, lines } = await req.json();
  const { token, host } = await getLW();

  const init = await fetch(`https://${host}/api/PurchaseOrder/Create_PurchaseOrder_Initial`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ supplierId, locationId, currency, deliveryDate: deliveryDateISO }),
  }).then(r => r.json());

  for (const line of lines) {
    await fetch(`https://${host}/api/PurchaseOrder/Add_PurchaseOrderItem`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        addItemParameter: {
          pkPurchaseId: init.pkPurchaseId,
          pkStockItemId: line.stockItemId,
          Qty: line.qty,
          UnitCost: line.unitCost,
        },
      }),
    });
  }
  return NextResponse.json({ purchaseId: init.pkPurchaseId, lineCount: lines.length });
}
