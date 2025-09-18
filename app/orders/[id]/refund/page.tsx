// app/orders/[orderId]/refund/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Line = {
  id: string;
  productTitle: string | null;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  // Either grossInc (preferred) or net + vatRate
  price?: number | null;         // unit price (what your API returns today)
  total?: number | null;         // unit * qty (what your API returns today)
};

type OrderJson = {
  id: string;
  shopifyOrderId?: string | null;
  shopifyName?: string | null;
  taxes?: number | null;
  subtotal?: number | null;
  total?: number | null;
  vatRate?: number | null;       // if your API exposes it
  lineItems?: Line[];
};

const VAT_RATE_FALLBACK = 0.2;

function fmt(n: number) {
  return `£${(Math.round(n * 100) / 100).toFixed(2)}`;
}

export default function RefundPage() {
  const router = useRouter();
  const { orderId } = useParams<{ orderId: string }>();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<OrderJson | null>(null);
  const [error, setError] = useState<string | null>(null);

  // track refund quantities
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        // Reuse your existing order JSON endpoint if you have it.
        // If not, this will still render and you can point it to whichever API you use.
        const res = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load order");
        if (active) {
          setOrder(json as OrderJson);
          const qInit: Record<string, number> = {};
          for (const li of (json.lineItems || [])) qInit[li.id] = 0;
          setQuantities(qInit);
        }
      } catch (e: any) {
        if (active) setError(e?.message || "Failed to load order");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [orderId]);

  const vatRate =
    order?.vatRate != null && order.vatRate >= 0 ? order.vatRate : VAT_RATE_FALLBACK;

  // Total selected refund (GROSS) – assumes order.price/total already include VAT
  const refundTotal = useMemo(() => {
    if (!order?.lineItems) return 0;
    let t = 0;
    for (const li of order.lineItems) {
      const q = quantities[li.id] || 0;
      const unitGross =
        (li.total && li.quantity ? li.total / li.quantity : li.price || 0);
      t += unitGross * q;
    }
    return t;
  }, [order, quantities]);

  async function submitRefund() {
    try {
      if (!order) return;
      const lines = (order.lineItems || [])
        .map((li) => {
          const q = quantities[li.id] || 0;
          if (!q) return null;
          const unitGross =
            (li.total && li.quantity ? li.total / li.quantity : li.price || 0);
          return {
            id: li.id,
            sku: li.sku,
            productTitle: li.productTitle,
            variantTitle: li.variantTitle,
            unitGross,            // £ inc VAT
            quantity: q,
          };
        })
        .filter(Boolean);

      if (!lines.length) {
        setError("Choose at least one quantity to refund.");
        return;
      }

      const res = await fetch("/api/payments/stripe/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          shopifyOrderId: order.shopifyOrderId || null,
          lines,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Refund failed");
      // Back to order page
      router.push(`/orders/${order.id}?refunded=1`);
    } catch (e: any) {
      setError(e?.message || "Refund failed");
    }
  }

  if (loading) return <section className="card">Loading…</section>;
  if (error) return <section className="card">Error: {error}</section>;
  if (!order) return <section className="card">Order not found.</section>;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Refund Order {order.shopifyName ? `(${order.shopifyName})` : ""}</h1>
        <a className="btn" href={`/orders/${order.id}`}>Back to order</a>
      </section>

      <section className="card">
        <h3>Items</h3>
        <div className="grid" style={{ gap: 10 }}>
          {(order.lineItems || []).map((li) => {
            const unitGross =
              (li.total && li.quantity ? li.total / li.quantity : li.price || 0);
            return (
              <div key={li.id} className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {li.productTitle || "—"}
                  </div>
                  <div className="small muted">
                    {li.variantTitle || ""}{li.sku ? ` • ${li.sku}` : ""} • Unit {fmt(unitGross)}
                  </div>
                  <div className="small muted">Purchased: {li.quantity}</div>
                </div>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <label className="small muted" style={{ marginRight: 4 }}>Refund qty</label>
                  <input
                    type="number"
                    min={0}
                    max={li.quantity}
                    value={quantities[li.id] || 0}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(li.quantity, Number(e.target.value || 0)));
                      setQuantities((q) => ({ ...q, [li.id]: v }));
                    }}
                    style={{ width: 90 }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card right">
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <div style={{ textAlign: "right" }}>
            <div>VAT rate: {(vatRate * 100).toFixed(0)}%</div>
            <div style={{ fontWeight: 700, marginTop: 6 }}>
              Refund total: {fmt(refundTotal)}
            </div>
          </div>
        </div>
      </section>

      <div className="right">
        <button className="primary" onClick={submitRefund} disabled={refundTotal <= 0}>
          Refund {fmt(refundTotal)}
        </button>
      </div>
    </div>
  );
}
