// app/orders/new/ClientNewOrder.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import ShopifyProductPicker from "@/components/ShopifyProductPicker";

// ---- Types ---------------------------------------------------------------
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
  shopifyCustomerId?: string | null;
};

type CartLine = {
  variantId: number;         // Shopify variant id (numeric)
  productTitle: string;
  title: string;             // variant title
  sku?: string | null;
  priceEx: number;           // unit EX VAT
  qty: number;
  image?: string | null;
};

const VAT_RATE = Number(process.env.NEXT_PUBLIC_VAT_RATE ?? "0.20");

// money helper
const formatGBP = (n: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(
    Number.isFinite(n) ? n : 0
  );

const clampQty = (v: any) => {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

// ---- Component -----------------------------------------------------------
export default function ClientNewOrder() {
  // detect customerId from the URL so the page works when opened as /orders/new?customerId=...
  const [customerId, setCustomerId] = useState<string | null>(null);
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const cid = u.searchParams.get("customerId");
      setCustomerId(cid);
    } catch {}
  }, []);

  // Load a light customer card for the header (optional)
  const [customer, setCustomer] = useState<Customer | null>(null);
  useEffect(() => {
    if (!customerId) return;
    (async () => {
      try {
        const res = await fetch(`/api/customers/basic?id=${encodeURIComponent(customerId)}`, {
          cache: "no-store",
        });
        if (res.ok) setCustomer(await res.json());
      } catch {}
    })();
  }, [customerId]);

  // cart
  const [cart, setCart] = useState<CartLine[]>([]);
  const addToCart = (v: {
    variantId: number | string;
    productTitle: string;
    title: string;
    sku?: string | null;
    priceEx: number | string | null;
    image?: string | null;
  }) => {
    const vid = Number(v.variantId);
    const priceEx = Number(v.priceEx ?? 0);
    if (!Number.isFinite(vid) || !Number.isFinite(priceEx)) return;

    setCart((prev) => {
      const i = prev.findIndex((x) => x.variantId === vid);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      return [
        ...prev,
        {
          variantId: vid,
          productTitle: v.productTitle,
          title: v.title,
          sku: v.sku ?? null,
          priceEx,
          qty: 1,
          image: v.image ?? null,
        },
      ];
    });
  };
  const updateQty = (vid: number, qty: any) =>
    setCart((prev) => prev.map((l) => (l.variantId === vid ? { ...l, qty: clampQty(qty) } : l)));
  const removeLine = (vid: number) => setCart((prev) => prev.filter((l) => l.variantId !== vid));

  // totals (cart-wide)
  const totals = useMemo(() => {
    let net = 0;
    for (const l of cart) net += l.priceEx * l.qty;
    const vat = net * VAT_RATE;
    const inc = net + vat;
    return { net, vat, inc };
  }, [cart]);

  // --- Draft handling -----------------------------------------------------
  const [creating, setCreating] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);

  /** Always ensure a draft exists on Shopify for the current cart. */
  async function ensureDraft(): Promise<string> {
    if (!cart.length) throw new Error("Add at least one product before continuing.");
    setCreating(true);
    try {
      const body = {
        customerId: customerId, // CRM id (server will attach Shopify customer/address)
        lines: cart.map((l) => ({
          variant_id: l.variantId,
          quantity: l.qty,
          price: l.priceEx, // EX VAT; server sets taxes_included:false
        })),
      };

      const res = await fetch("/api/shopify/draft-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(String(e?.error || `Draft create failed: ${res.status}`));
      }

      const j = await res.json();
      const id = String(j?.id || j?.draft_order?.id);
      if (!id) throw new Error("Draft created but no id returned.");
      setDraftId(id);
      return id;
    } finally {
      setCreating(false);
    }
  }

  // --- Payment actions ----------------------------------------------------
  async function payByCard() {
    try {
      const id = await ensureDraft();
      const r = await fetch("/api/stripe/checkout-from-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: id,
          crmCustomerId: customerId,
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(String(e?.error || `Checkout failed: ${r.status}`));
      }
      const { url } = await r.json();
      if (url) window.location.href = url;
    } catch (e: any) {
      alert(`Pay by card failed: ${e?.message || e}`);
    }
  }

  async function createPaymentLink() {
    try {
      const id = await ensureDraft();
      const r = await fetch("/api/stripe/payment-link-from-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: id,
          crmCustomerId: customerId,
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(String(e?.error || `Payment link failed: ${r.status}`));
      }
      const { url } = await r.json();
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        try {
          await navigator.clipboard.writeText(url);
        } catch {}
      }
    } catch (e: any) {
      alert(`Payment link failed: ${e?.message || e}`);
    }
  }

  // --- Rendering helpers --------------------------------------------------
  const renderCustomer = () => {
    if (!customer) {
      return (
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="small muted">No customer selected.</div>
          <a className="btn" href="/customers">Select customer</a>
        </div>
      );
    }
    const addr = [
      customer.addressLine1,
      customer.addressLine2,
      customer.town,
      customer.county,
      customer.postCode,
      customer.country,
    ]
      .filter(Boolean)
      .join("\n");

    return (
      <div>
        <b>{customer.salonName || customer.customerName}</b>
        <p className="small" style={{ marginTop: 6, whiteSpace: "pre-line" }}>
          {customer.customerName ? `${customer.customerName} • ` : ""}
          {customer.customerTelephone || "-"}
          {customer.customerEmailAddress ? ` • ${customer.customerEmailAddress}` : ""}
          {"\n\n"}
          {addr || "-"}
        </p>
      </div>
    );
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Customer panel at the top */}
      <section className="card">
        <h1 style={{ marginTop: 0, marginBottom: 12 }}>Create Order</h1>
        {renderCustomer()}
      </section>

      {/* Product search (Shopify-like) */}
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Search Products</h3>
        </div>

        <div style={{ marginTop: 12 }}>
          <ShopifyProductPicker
            placeholder="Search by product title, SKU, vendor…"
            onPick={(v) =>
              addToCart({
                variantId: v.variantId,
                productTitle: v.productTitle,
                title: v.title,
                sku: v.sku,
                priceEx: v.priceEx,
                image: v.image,
              })
            }
          />
        </div>
      </section>

      {/* Cart */}
      <section className="card">
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Cart</h3>
        {cart.length === 0 ? (
          <p className="small muted">No items yet.</p>
        ) : (
          <div className="grid" style={{ gap: 12 }}>
            {cart.map((l) => {
              const unitNet = l.priceEx;
              const unitVat = unitNet * VAT_RATE;
              const unitInc = unitNet + unitVat;

              return (
                <div
                  key={l.variantId}
                  className="row"
                  style={{
                    gap: 12,
                    alignItems: "center",
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: 12,
                  }}
                >
                  {/* image */}
                  {l.image ? (
                    <img
                      src={l.image}
                      alt=""
                      width={46}
                      height={46}
                      style={{ borderRadius: 10, objectFit: "cover" }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 10,
                        background: "#f3f4f6",
                        border: "1px solid var(--border)",
                      }}
                    />
                  )}

                  {/* titles & unit prices */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{l.productTitle}</div>
                    <div className="small muted" style={{ marginTop: 2 }}>
                      {l.sku ? `SKU: ${l.sku}` : ""} {l.sku ? " • " : ""}
                      {l.title}
                    </div>
                    <div className="small" style={{ marginTop: 6 }}>
                      Ex VAT: <b>{formatGBP(unitNet)}</b> &nbsp; VAT ({Math.round(VAT_RATE * 100)}%):{" "}
                      <b>{formatGBP(unitVat)}</b> &nbsp; Inc VAT: <b>{formatGBP(unitInc)}</b>
                    </div>
                  </div>

                  {/* qty bubble + remove */}
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input
                      type="number"
                      min={1}
                      value={l.qty}
                      onChange={(e) => updateQty(l.variantId, e.target.value)}
                      style={{
                        width: 64,
                        height: 40,
                        borderRadius: 14,
                        textAlign: "center",
                        border: "1px solid var(--field-border)",
                        background: "var(--field-bg)",
                      }}
                    />
                    <button className="btn" onClick={() => removeLine(l.variantId)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Totals */}
            <div className="row" style={{ justifyContent: "flex-end", gap: 18 }}>
              <div className="small muted">Net:</div>
              <div style={{ textAlign: "right", minWidth: 100 }}>{formatGBP(totals.net)}</div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 18 }}>
              <div className="small muted">VAT ({Math.round(VAT_RATE * 100)}%):</div>
              <div style={{ textAlign: "right", minWidth: 100 }}>{formatGBP(totals.vat)}</div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 18 }}>
              <div className="small muted" style={{ fontWeight: 700 }}>
                Total:
              </div>
              <div style={{ textAlign: "right", minWidth: 100, fontWeight: 700 }}>
                {formatGBP(totals.inc)}
              </div>
            </div>

            {/* Actions */}
            <div
              className="row"
              style={{ marginTop: 14, gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}
            >
              <button className="btn" type="button" onClick={ensureDraft} disabled={creating}>
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
