"use client";

import { useMemo, useState } from "react";

export type Line = {
  /** CRM orderLineItem id (used for qty_… form field names) */
  id: string;
  /** Max quantity refundable (original purchased qty) */
  maxQty: number;
  /** Shopify numeric line item id (not used by the form, but handy to keep) */
  shopifyLineItemId: number;
  /** Unit net (ex VAT) in GBP */
  unitNet: number;
  /** For display only */
  productTitle?: string;
  sku?: string | null;
};

type Props = {
  orderId: string;
  currency: string; // "GBP"
  lines: Line[];
};

const VAT_RATE = Number(process.env.NEXT_PUBLIC_VAT_RATE ?? "0.20");

function fmt(n: number, currency = "GBP") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `£${n.toFixed(2)}`;
  }
}

export default function RefundClient({ orderId, currency, lines }: Props) {
  // keep qty state per line id
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(lines.map(l => [l.id, 0]))
  );

  const totals = useMemo(() => {
    const net = lines.reduce((sum, l) => sum + (l.unitNet * (qty[l.id] || 0)), 0);
    const vat = net * VAT_RATE;
    const gross = net + vat;
    return { net, vat, gross };
  }, [lines, qty]);

  const canSubmit = totals.gross > 0.000001;

  return (
    <form
      method="POST"
      action={`/api/orders/${orderId}/refund`}
      className="grid"
      style={{ gap: 12, marginTop: 12 }}
    >
      {/* Line table */}
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
            <div>{li.productTitle || "-"}</div>
            <div>{li.sku || "-"}</div>
            <div>{li.maxQty}</div>
            <div>{fmt(li.unitNet, currency)} ex VAT</div>
            <div>
              <input
                type="number"
                name={`qty_${li.id}`}
                min={0}
                max={li.maxQty}
                value={qty[li.id] ?? 0}
                onChange={(e) => {
                  const val = Math.max(0, Math.min(li.maxQty, Number(e.target.value || 0)));
                  setQty((q) => ({ ...q, [li.id]: val }));
                }}
                style={{ width: 90 }}
                data-refund-qty
              />
            </div>
          </div>
        ))}
      </div>

      <textarea
        name="reason"
        placeholder="Reason (optional)"
        className="textarea"
        rows={3}
      />

      {/* Summary */}
      <div className="card" style={{ padding: 12 }}>
        <b>Refund summary</b>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
          <div style={{ textAlign: "right" }}>
            <div className="small">Net: <b>{fmt(totals.net, currency)}</b></div>
            <div className="small">VAT ({Math.round(VAT_RATE * 100)}%): <b>{fmt(totals.vat, currency)}</b></div>
            <div style={{ marginTop: 4, fontWeight: 700 }}>
              Total to refund: {fmt(totals.gross, currency)}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="right row" style={{ gap: 8 }}>
        <a className="btn" href={`/orders/${orderId}`}>Cancel</a>
        <button
          className="primary"
          type="submit"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          title={canSubmit ? undefined : "Add at least one item to refund"}
        >
          Process refund
        </button>
      </div>
    </form>
  );
}
