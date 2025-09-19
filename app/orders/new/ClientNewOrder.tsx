// app/orders/new/ClientNewOrder.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ShopifyProductPicker from "@/components/ShopifyProductPicker";

type CartLine = {
  variantId: number;
  productTitle: string;
  title: string;          // variant title (may be "Default Title")
  sku?: string | null;
  qty: number;
  priceEx: number;        // unit price ex VAT
};

const VAT_RATE = 0.20;

function money(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(n);
}

export default function ClientNewOrder() {
  const sp = useSearchParams();
  const customerId = sp.get("customerId") || "";

  const [cart, setCart] = useState<CartLine[]>([]);

  function addToCart(v: {
    id: string | number;
    productTitle: string;
    title: string;
    sku?: string | null;
    price: string | null; // ex VAT from /api/shopify/products
  }) {
    const variantId = Number(v.id);
    const unitEx = v.price ? Number(v.price) : 0;
    setCart((prev) => {
      const i = prev.findIndex((l) => l.variantId === variantId);
      if (i >= 0) {
        const next = prev.slice();
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      return [
        ...prev,
        {
          variantId,
          productTitle: v.productTitle || "",
          title: v.title || "",
          sku: v.sku ?? undefined,
          qty: 1,
          priceEx: unitEx,
        },
      ];
    });
  }

  function updateQty(variantId: number, qty: number) {
    setCart((prev) =>
      prev.map((l) => (l.variantId === variantId ? { ...l, qty: Math.max(1, qty) } : l)),
    );
  }

  function removeLine(variantId: number) {
    setCart((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  const totals = useMemo(() => {
    const ex = cart.reduce((s, l) => s + l.priceEx * l.qty, 0);
    const tax = ex * VAT_RATE;
    const inc = ex + tax;
    return { ex, tax, inc };
  }, [cart]);

  // Wire this to your existing draft-order endpoint if you already have one.
  async function createDraft() {
    if (cart.length === 0) return;
    try {
      const r = await fetch("/api/shopify/draft-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId, // your server can translate this to Shopify customer id
          lines: cart.map((l) => ({
            variant_id: l.variantId,
            quantity: l.qty,
            price: l.priceEx, // ex VAT
            title: l.productTitle,
          })),
          total_ex_vat: totals.ex,
          vat_rate: VAT_RATE,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        alert(`Draft creation failed: ${r.status}\n${t}`);
        return;
      }
      const j = await r.json().catch(() => null);
      const draftId = j?.draft?.id || j?.draft_order?.id || null;
      if (draftId) {
        // open admin draft – adjust domain if you want to redirect somewhere else
        window.open(
          `https://${(process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN || "")
            .replace(/^https?:\/\//, "")
            .replace(/\/$/, "")}/admin/draft_orders/${draftId}`,
          "_blank",
        );
      }
    } catch (e: any) {
      alert(e?.message || "Draft creation error");
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Context / navigation */}
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <Link className="btn" href="/customers">Back</Link>
            <span className="small muted">
              {customerId ? `For customer ID: ${customerId}` : "No customer selected"}
            </span>
          </div>
        </div>
      </section>

      {/* Customer summary could go here (left as-is in your project) */}

      {/* Shopify-style product search */}
      <ShopifyProductPicker
        placeholder="Search by product title, SKU, vendor…"
        onAdd={(v) =>
          addToCart({
            id: v.id,
            productTitle: v.productTitle,
            title: v.title,
            sku: v.sku,
            price: v.price,
          })
        }
      />

      {/* Cart */}
      <section className="card">
        <h3 style={{ marginTop: 0 }}>Cart</h3>
        {cart.length === 0 ? (
          <p className="small muted">No items yet.</p>
        ) : (
          <div style={{ marginTop: 8 }}>
            {cart.map((l) => (
              <div
                key={l.variantId}
                className="row"
                style={{
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{l.productTitle}</div>
                  {l.title && l.title !== "Default Title" && (
                    <div className="small muted">{l.title}</div>
                  )}
                  {l.sku && <div className="small muted">SKU: {l.sku}</div>}
                </div>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input
                    type="number"
                    min={1}
                    value={l.qty}
                    onChange={(e) => updateQty(l.variantId, Number(e.target.value || "1"))}
                    style={{ width: 70 }}
                  />
                  <div className="small">{money(l.priceEx)}</div>
                  <button type="button" className="btn" onClick={() => removeLine(l.variantId)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}

            {/* Totals */}
            <div style={{ marginTop: 12 }}>
              <div className="row" style={{ justifyContent: "flex-end", gap: 18 }}>
                <div className="small muted">Net:</div>
                <div style={{ minWidth: 100, textAlign: "right" }}>{money(totals.ex)}</div>
              </div>
              <div className="row" style={{ justifyContent: "flex-end", gap: 18 }}>
                <div className="small muted">VAT (20%):</div>
                <div style={{ minWidth: 100, textAlign: "right" }}>{money(totals.tax)}</div>
              </div>
              <div className="row" style={{ justifyContent: "flex-end", gap: 18 }}>
                <div className="small" style={{ fontWeight: 700 }}>Total to refund:</div>
                <div style={{ minWidth: 100, textAlign: "right", fontWeight: 700 }}>
                  {money(totals.inc)}
                </div>
              </div>
            </div>

            <div className="right" style={{ marginTop: 14 }}>
              <button className="primary" type="button" onClick={createDraft} disabled={!cart.length}>
                Create Draft Order
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
