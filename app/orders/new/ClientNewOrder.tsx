// app/orders/new/ClientNewOrder.tsx
"use client";

import { useMemo, useState, useEffect } from "react";
import ShopifyProductPicker from "@/components/ShopifyProductPicker";

type Customer = {
  id: string;
  salonName?: string | null;
  customerName?: string | null;
  customerEmailAddress?: string | null;
  customerTelephone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  town?: string | null;
  county?: string | null;
  postCode?: string | null;
  country?: string | null;
};

type CartLine = {
  variantId: number;
  productTitle: string;
  title: string;
  sku?: string | null;
  qty: number;
  priceEx: number; // unit EX VAT
};

const VAT_RATE = 0.2;

function money(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(n);
}

async function searchCustomers(q: string) {
  if (!q.trim()) return [];
  const r = await fetch(`/api/customers?q=${encodeURIComponent(q)}&limit=25`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!r.ok) return [];
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j : [];
}

export default function ClientNewOrder({ initialCustomer }: { initialCustomer: Customer | null }) {
  const [customer, setCustomer] = useState<Customer | null>(initialCustomer);

  // ------------------------ Select customer (when none) ------------------------
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let abort = false;
    if (!customer && q.trim().length >= 2) {
      setLoading(true);
      const t = setTimeout(async () => {
        const rows = await searchCustomers(q);
        if (!abort) setResults(rows);
        setLoading(false);
      }, 200);
      return () => {
        abort = true;
        clearTimeout(t);
      };
    } else {
      setResults([]);
    }
  }, [q, customer]);

  function selectCustomer(c: any) {
    const id = c?.id || c?.customerId || c?.customer_id;
    if (!id) return;
    window.location.href = `/orders/new?customerId=${encodeURIComponent(id)}`;
  }

  // ---------------------------------- cart ----------------------------------
  const [cart, setCart] = useState<CartLine[]>([]);
  const [creating, setCreating] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);

  function addToCart(v: {
    id: string | number;
    productTitle: string;
    title: string;
    sku?: string | null;
    price: string | null; // unit EX VAT as string from Admin API
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

  // ----------------------- Draft creation / reuse -----------------------
  async function ensureDraft(): Promise<string | null> {
    if (draftId) return draftId;
    if (!customer) {
      alert("Select a customer first.");
      return null;
    }
    if (cart.length === 0) {
      alert("Add at least one product first.");
      return null;
    }

    try {
      setCreating(true);

      // Build Shopify-style line items once
      const items = cart.map((l) => ({
        variant_id: l.variantId,
        quantity: l.qty,
        price: Number(l.priceEx), // EX VAT
        title: l.productTitle,
      }));

      // Send multiple shapes so whichever your API expects will match.
      const payload = {
        customerId: customer.id,
        lines: items, // old handler
        line_items: items, // alt handler
        draft_order: {
          line_items: items,
          taxes_included: false,
          use_customer_default_address: true,
        },
        vat_rate: VAT_RATE,
      };

      const r = await fetch("/api/shopify/draft-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Cart-Count": String(cart.length),
        },
        body: JSON.stringify(payload),
      });

      setCreating(false);

      if (!r.ok) {
        const t = await r.text();
        console.error("Draft create failed:", r.status, t, payload);
        alert(`Draft creation failed: ${r.status}\n${t || "(no body)"}`);
        return null;
      }

      const j = await r.json().catch(() => null);
      const id = j?.draft?.id || j?.draft_order?.id || j?.id || null;
      if (!id) {
        console.error("Draft create: no ID in response", j);
        alert("Draft created but no ID returned.");
        return null;
      }

      setDraftId(String(id));
      return String(id);
    } catch (e: any) {
      setCreating(false);
      console.error(e);
      alert(e?.message || "Draft creation error");
      return null;
    }
  }

  async function handleCreateDraftClick() {
    await ensureDraft();
  }

  // ----------------------------- Payments -----------------------------
  async function payByCard() {
    const id = await ensureDraft();
    if (!id || !customer) return;

    try {
      const r = await fetch("/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id, customerId: customer.id }),
      });
      if (!r.ok) {
        const t = await r.text();
        alert(`Checkout creation failed: ${r.status}\n${t}`);
        return;
      }
      const j = await r.json().catch(() => null);
      const url = j?.url || j?.session_url;
      if (url) window.location.href = url;
      else alert("No checkout URL returned from server.");
    } catch (e: any) {
      alert(e?.message || "Checkout error");
    }
  }

  async function createPaymentLink() {
    const id = await ensureDraft();
    if (!id || !customer) return;

    try {
      const r = await fetch("/api/payments/stripe/payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id, customerId: customer.id }),
      });
      if (!r.ok) {
        const t = await r.text();
        alert(`Payment link failed: ${r.status}\n${t}`);
        return;
      }
      const j = await r.json().catch(() => null);
      const url = j?.url || j?.link?.url;
      if (url) {
        try { await navigator.clipboard.writeText(url); } catch {}
        window.open(url, "_blank");
      } else {
        alert("No payment link URL returned from server.");
      }
    } catch (e: any) {
      alert(e?.message || "Payment link error");
    }
  }

  // ---------- tiny style helpers (avoid styled-jsx so Vercel build doesn’t crash) ----------
  const resultRowStyle: React.CSSProperties = {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 6,
    alignItems: "center",
    background: "#fff",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "10px 12px",
    margin: "8px 0",
    textAlign: "left",
    cursor: "pointer",
  };
  const lineStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 12,
    alignItems: "center",
    padding: "10px 0",
    borderBottom: "1px solid var(--border)",
  };
  const linePricesStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "max-content max-content max-content",
    gap: 12,
    marginTop: 6,
  };
  const qtyStyle: React.CSSProperties = {
    width: 64,
    height: 40,
    textAlign: "center",
    borderRadius: 12,
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* CUSTOMER PANEL */}
      {customer ? (
        <section className="card">
          <b>Customer</b>
          <div className="small" style={{ marginTop: 6 }}>
            <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>
              {customer.salonName || customer.customerName || "Customer"}
            </div>
            <div className="small muted">
              {customer.customerName || "-"}
              {customer.customerTelephone ? ` • ${customer.customerTelephone}` : ""}
              {customer.customerEmailAddress ? ` • ${customer.customerEmailAddress}` : ""}
            </div>
            <div style={{ marginTop: 10, whiteSpace: "pre-line" }}>
              {[customer.addressLine1, customer.addressLine2, customer.town, customer.county, customer.postCode]
                .filter(Boolean)
                .join("\n")}
            </div>
          </div>
          <div className="right" style={{ marginTop: 10 }}>
            <a className="btn" href="/customers">Change customer</a>
          </div>
        </section>
      ) : (
        <section className="card">
          <b>Select customer</b>
          <input
            placeholder="Search name, email, town…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ marginTop: 8 }}
          />
          {q.trim().length < 2 ? (
            <p className="small muted" style={{ marginTop: 8 }}>
              Type at least 2 characters to search.
            </p>
          ) : loading ? (
            <p className="small muted" style={{ marginTop: 8 }}>Searching…</p>
          ) : results.length === 0 ? (
            <p className="small muted" style={{ marginTop: 8 }}>No matches.</p>
          ) : (
            <div style={{ marginTop: 8 }}>
              {results.map((c: any) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCustomer(c)}
                  style={resultRowStyle}
                  title="Select customer"
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {c.salonName || c.customerName || "Customer"}
                    </div>
                    <div className="small muted" style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {[c.customerName, c.town, c.customerEmailAddress].filter(Boolean).join(" • ")}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* PRODUCT SEARCH */}
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

      {/* CART */}
      <section className="card">
        <h3 style={{ marginTop: 0 }}>Cart</h3>
        {cart.length === 0 ? (
          <p className="small muted">No items yet.</p>
        ) : (
          <div style={{ marginTop: 8 }}>
            {cart.map((l) => {
              const lineEx = l.priceEx * l.qty;
              const lineVat = lineEx * VAT_RATE;
              const lineInc = lineEx + lineVat;
              return (
                <div key={l.variantId} style={lineStyle}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{l.productTitle}</div>
                    {l.title && l.title !== "Default Title" && (
                      <div className="small muted">{l.title}</div>
                    )}
                    {l.sku && <div className="small muted">SKU: {l.sku}</div>}
                    <div style={linePricesStyle}>
                      <div className="small">Ex VAT: <b>{money(lineEx)}</b></div>
                      <div className="small">VAT (20%): <b>{money(lineVat)}</b></div>
                      <div className="small">Inc VAT: <b>{money(lineInc)}</b></div>
                    </div>
                  </div>

                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input
                      style={qtyStyle}
                      className="qty"
                      type="number"
                      min={1}
                      value={l.qty}
                      onChange={(e) => updateQty(l.variantId, Number(e.target.value || "1"))}
                    />
                    <button type="button" className="btn" onClick={() => removeLine(l.variantId)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}

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
                <div className="small" style={{ fontWeight: 700 }}>Total:</div>
                <div style={{ minWidth: 100, textAlign: "right", fontWeight: 700 }}>
                  {money(totals.inc)}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button className="btn" type="button" onClick={handleCreateDraftClick} disabled={creating}>
                {creating ? "Creating draft…" : draftId ? "Re-create draft" : "Create draft order"}
              </button>

              <button className="primary" type="button" onClick={payByCard} disabled={creating}>
                Pay by card
              </button>

              <button className="btn" type="button" onClick={createPaymentLink} disabled={creating}>
                Payment link
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
