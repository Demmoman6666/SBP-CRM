"use client";

import { useEffect, useState } from "react";

type Line = {
  id: string;                 // CRM line id (used in input name: qty_<id>)
  shopifyLineItemId: number;  // numeric Shopify line_item_id
  maxQty: number;
};

export default function RefundClient({
  orderId,
  currency = "GBP",
  lines,
}: {
  orderId: string;
  currency?: string;
  lines: Line[];
}) {
  const [amount, setAmount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    const inputs = lines
      .map((l) => document.querySelector<HTMLInputElement>(`input[name="qty_${l.id}"]`))
      .filter(Boolean) as HTMLInputElement[];

    async function recalc() {
      if (aborted) return;
      setErr(null);
      const payload = {
        items: lines
          .map((l) => {
            const el = document.querySelector<HTMLInputElement>(`input[name="qty_${l.id}"]`);
            const q = Number(el?.value || 0);
            if (!Number.isFinite(q) || q <= 0) return null;
            return { line_item_id: l.shopifyLineItemId, quantity: Math.min(q, l.maxQty) };
          })
          .filter(Boolean),
      };

      // no refund items → zero
      if (!payload.items.length) {
        setAmount(0);
        return;
      }

      try {
        setBusy(true);
        const res = await fetch(`/api/orders/${orderId}/refund/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Preview failed");
        if (!aborted) setAmount(Number(json.amount || 0));
      } catch (e: any) {
        if (!aborted) {
          setAmount(0);
          setErr(e?.message || "Preview failed");
        }
      } finally {
        if (!aborted) setBusy(false);
      }
    }

    // debounce
    let t: any;
    const onChange = () => {
      clearTimeout(t);
      t = setTimeout(recalc, 150);
    };

    inputs.forEach((el) => el.addEventListener("input", onChange));
    recalc();

    return () => {
      aborted = true;
      clearTimeout(t);
      inputs.forEach((el) => el.removeEventListener("input", onChange));
    };
  }, [orderId, lines]);

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "GBP" }).format(
      Number.isFinite(n) ? n : 0
    );

  return (
    <div className="small" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="muted">Refund preview from Shopify</span>
        <strong>{busy ? "…" : fmt(amount)}</strong>
      </div>
      {err && (
        <div className="small" style={{ color: "var(--danger, #b91c1c)", marginTop: 4 }}>
          {err}
        </div>
      )}
      <input type="hidden" name="_refundPreviewAmount" value={String(amount)} />
    </div>
  );
}
