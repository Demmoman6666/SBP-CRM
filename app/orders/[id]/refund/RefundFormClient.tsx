"use client";

import { useMemo, useState } from "react";

type Line = {
  id: string;            // CRM line-item id
  productTitle: string;  // nice name
  sku?: string | null;
  maxQty: number;        // purchased qty
  unitNet: number;       // ex VAT unit price (number)
};

export default function RefundFormClient({
  orderId,
  currency,
  vatRate,
  lines,
}: {
  orderId: string;
  currency: string;
  vatRate: number; // e.g. 0.2
  lines: Line[];
}) {
  // qty state keyed by line.id
  const [qty, setQty] = useState<Record<string, number>>(
    () =>
      Object.fromEntries(
        lines.map((l) => [l.id, 0])
      ) as Record<string, number>
  );

  const fmt = useMemo(
    () => new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "GBP" }),
    [currency]
  );

  const totals = useMemo(() => {
    const net = lines.reduce((sum, l) => sum + (qty[l.id] || 0) * (l.unitNet || 0), 0);
    const vat = net * vatRate;
    const gross = net + vat;
    return { net, vat, gross };
  }, [lines, qty, vatRate]);

  function onQtyChange(id: string, val: number, max: number) {
    const v = Math.min(Math.max(0, Math.floor(val || 0)), max);
    setQty((q) => ({ ...q, [id]: v }));
  }

  return (
    <form
      method="POST"
      action={`/api/orders/${orderId}/refund`}
      className="grid"
      style={{ gap: 12, marginTop: 12 }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
          gap: 8,
          alignItems: "center",
        }}
      >
        <div className="small muted">Product</div>
        <div className="small muted">SKU</div>
        <div className="small muted">Qty (max)</div>
        <div className="small muted">Unit</div>
        <div className="small muted">Refund Qty</div>

        {lines.map((li) => (
          <div key={li.id} style={{ display: "contents" }}>
            <div>{li.productTitle}</div>
            <div>{li.sku || "-"}</div>
            <div>{li.maxQty}</div>
            <div>{fmt.format(li.unitNet)}</div>
            <div>
              <input
                type="number"
                name={`qty_${li.id}`}        // parsed by your API
                min={0}
                max={li.maxQty}
                value={qty[li.id] ?? 0}
                onChange={(e) => onQtyChange(li.id, Number(e.target.value), li.maxQty)}
                step={1}
                style={{ width: 90 }}
              />
            </div>
          </div>
        ))}
      </div>

      <textarea name="reason" placeholder="Reason (optional)" className="textarea" rows={3} />

      {/* Live refund summary */}
      <div className="card" style={{ background: "#fafafa" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <b>Refund summary</b>
          <div style={{ textAlign: "right" }}>
            <div className="small">Net: <b>{fmt.format(totals.net)}</b></div>
            <div className="small">VAT ({Math.round(vatRate * 100)}%): <b>{fmt.format(totals.vat)}</b></div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>
              Total to refund: <span>{fmt.format(totals.gross)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="right row" style={{ gap: 8 }}>
        <a className="btn" href={`/orders/${orderId}`}>Cancel</a>
        <button className="primary" type="submit">Process refund</button>
      </div>
    </form>
  );
}
