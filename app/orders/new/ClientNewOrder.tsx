// app/orders/new/ClientNewOrder.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import ShopifyProductPicker from "@/components/ShopifyProductPicker";

type Customer = {
  id: string;
  salonName: string | null;
  customerName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  town: string | null;
  county: string | null;
  postCode: string | null;
  country: string | null; // e.g. "GB"
  customerTelephone: string | null;
  customerEmailAddress: string | null;
};

type CartLine = {
  variantId: number;
  productTitle: string;
  title: string;
  sku?: string | null;
  priceEx: number; // unit ex VAT
  qty: number;
  image?: string | null;
};

type Props = {
  initialCustomer?: Customer | null;
};

const VAT_RATE = Number(process.env.NEXT_PUBLIC_VAT_RATE ?? "0.20");

const money = (n: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "GBP",
  }).format(Number.isFinite(n) ? n : 0);

export default function ClientNewOrder({ initialCustomer }: Props) {
  // customer
  const [customer, setCustomer] = useState<Customer | null>(
    initialCustomer ?? null
  );

  // show/hide picker
  const [showPicker, setShowPicker] = useState(true);

  // cart
  const [cart, setCart] = useState<CartLine[]>([]);
  const [creating, setCreating] = useState<false | "draft" | "checkout" | "plink">(false);
  const [draftId, setDraftId] = useState<number | null>(null);

  // helpers
  function addToCart(line: Omit<CartLine, "qty"> & { qty?: number }) {
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.variantId === line.variantId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + (line.qty ?? 1) };
        return next;
      }
      return [...prev, { ...line, qty: line.qty ?? 1 }];
    });
  }

  function setQty(variantId: number, qty: number) {
    setCart((prev) =>
      prev.map((l) => (l.variantId === variantId ? { ...l, qty } : l))
    );
  }

  function removeLine(variantId: number) {
    setCart((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  // totals
  const totals = useMemo(() => {
    const ex = cart.reduce((s, l) => s + l.priceEx * l.qty, 0);
    const vat = ex * VAT_RATE;
    const inc = ex + vat;
    return { ex, vat, inc };
  }, [cart]);

  // Ensure a Shopify draft exists (or re-create). Posts line items so server always sees them.
  async function ensureDraft(): Promise<number> {
    if (!cart.length) throw new Error("Cart is empty");

    setCreating("draft");
    try {
      const line_items = cart.map((l) => ({
        variant_id: l.variantId,
        quantity: l.qty,
      }));

      // tolerate both shapes: original `line_items` and a namespaced backup
      const body: any = {
        customerId: customer?.id ?? null,
        email: customer?.customerEmailAddress ?? null,
        shipping_address: customer
          ? {
            address1: customer.addressLine1 ?? "",
            address2: customer.addressLine2 ?? "",
            city: customer.town ?? "",
            province: customer.county ?? "",
            zip: customer.postCode ?? "",
            country_code: customer.country ?? "GB",
            name: customer.salonName || customer.customerName || "",
            phone: customer.customerTelephone ?? "",
          }
          : undefined,
        line_items,
        draft_order_line_items: line_items,
      };

      const resp = await fetch("/api/shopify/draft-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`Draft creation failed: ${resp.status} ${t}`);
      }

      const json = await resp.json().catch(() => ({} as any));
      // Accept either {id} or {draft_order:{id}} or the full draft payload
      const id: number | undefined =
        json?.id ??
        json?.draft_order?.id ??
        json?.draft_order?.order_id ??
        json?.draft?.id;

      if (!id) {
        throw new Error("Draft created but no id returned");
      }
      setDraftId(id);
      return id;
    } finally {
      setCreating(false);
    }
  }

  // Pay by card
  async function payByCard() {
    try {
      const id = draftId ?? (await ensureDraft());
      setCreating("checkout");
      // Try POST first (preferred); fall back to GET redirect if server expects it
      const r = await fetch("/api/stripe/checkout-for-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j?.url) {
          window.location.href = j.url as string;
          return;
        }
      }
      // fallback redirect
      window.location.href = `/api/stripe/checkout-for-draft?draftId=${id}`;
    } catch (e: any) {
      alert(e?.message || "Checkout failed");
    } finally {
      setCreating(false);
    }
  }

  // Payment link
  async function createPaymentLink() {
    try {
      const id = draftId ?? (await ensureDraft());
      setCreating("plink");
      const r = await fetch("/api/stripe/payment-link-for-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`Payment link failed: ${r.status} ${t}`);
      }
      const j = await r.json();
      const url: string | undefined = j?.url || j?.payment_link?.url;
      if (!url) throw new Error("No URL returned from payment link API");

      try {
        await navigator.clipboard.writeText(url);
      } catch {}
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      alert(e?.message || "Payment link failed");
    } finally {
      setCreating(false);
    }
  }

  // --- UI ---

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Customer panel */}
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <b>Customer</b>
          <a className="btn" href="/customers" title="Change or pick a different customer">
            Change customer
          </a>
        </div>

        {customer ? (
          <div className="small" style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700 }}>
              {customer.salonName || customer.customerName || "Customer"}
            </div>
            <div className="muted" style={{ marginTop: 2 }}>
              {customer.customerName || "-"}
              {customer.customerTelephone ? ` • ${customer.customerTelephone}` : ""}
              {customer.customerEmailAddress ? ` • ${customer.customerEmailAddress}` : ""}
            </div>
            <div className="muted" style={{ marginTop: 10, whiteSpace: "pre-line" }}>
              {[customer.addressLine1, customer.town, customer.county, customer.postCode]
                .filter(Boolean)
                .join("\n")}
            </div>
          </div>
        ) : (
          <div className="small muted" style={{ marginTop: 10 }}>
            No customer selected yet — <a href="/customers">choose one</a>.
          </div>
        )}
      </section>

      {/* Search & add products */}
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Search Products</h3>
          <button type="button" className="btn" onClick={() => setShowPicker((s) => !s)}>
            {showPicker ? "Hide" : "Show"}
          </button>
        </div>

        {showPicker && (
          <div style={{ marginTop: 10 }}>
            <ShopifyProductPicker
              placeholder="Search by product title, SKU, vendor…"
              onPick={(v) =>
                addToCart({
                  variantId: v.variantId,
                  productTitle: v.productTitle,
                  title: v.title,
                  sku: v.sku,
                  priceEx: v.priceEx,
                  image: v.image ?? null,
                })
              }
            />
          </div>
        )}
      </section>

      {/* Cart */}
      <section className="card">
        <h3 style={{ margin: 0, marginBottom: 8 }}>Cart</h3>
        {cart.length === 0 ? (
          <div className="small muted">No items yet.</div>
        ) : (
          <div className="grid" style={{ gap: 12 }}>
            {cart.map((l) => {
              const ex = l.priceEx * l.qty;
              const vat = ex * VAT_RATE;
              const inc = ex + vat;
              return (
                <div key={l.variantId} className="card" style={{ borderColor: "var(--border)", boxShadow: "none", padding: 12 }}>
                  <div className="row" style={{ alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {l.productTitle}
                      </div>
                      <div className="small muted">SKU: {l.sku || "—"}</div>
                    </div>

                    {/* Consistent qty “bubble” */}
                    <input
                      type="number"
                      min={1}
                      value={l.qty}
                      onChange={(e) => setQty(l.variantId, Math.max(1, Number(e.target.value || 1)))}
                      style={{
                        width: 64,
                        textAlign: "center",
                        borderRadius: 14,
                        height: 42,
                      }}
                    />

                    <button className="btn" type="button" onClick={() => removeLine(l.variantId)}>
                      Remove
                    </button>
                  </div>

                  {/* per-line pricing */}
                  <div className="small muted" style={{ marginTop: 8 }}>
                    Ex VAT: {money(ex)}{" "}
                    <span style={{ marginInline: 6 }}>•</span>
                    VAT ({Math.round(VAT_RATE * 100)}%): {money(vat)}{" "}
                    <span style={{ marginInline: 6 }}>•</span>
                    Inc VAT: {money(inc)}
                  </div>
                </div>
              );
            })}

            {/* Totals */}
            <div style={{ marginTop: 12 }}>
              <div className="row" style={{ justifyContent: "flex-end", gap: 18 }}>
                <div className="small muted">Net:</div>
                <div className="small">{money(totals.ex)}</div>
              </div>
              <div className="row" style={{ justifyContent: "flex-end", gap: 18 }}>
                <div className="small muted">
                  VAT ({Math.round(VAT_RATE * 100)}%):
                </div>
                <div className="small">{money(totals.vat)}</div>
              </div>
              <div className="row" style={{ justifyContent: "flex-end", gap: 18 }}>
                <div className="small" style={{ fontWeight: 700 }}>
                  Total:
                </div>
                <div className="small" style={{ fontWeight: 700 }}>
                  {money(totals.inc)}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div
              className="row"
              style={{
                marginTop: 14,
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  try {
                    await ensureDraft();
                    alert("Draft created (or refreshed).");
                  } catch (e: any) {
                    alert(e?.message || "Draft error");
                  }
                }}
                disabled={creating !== false}
              >
                {creating === "draft" ? "Creating draft…" : draftId ? "Re-create draft" : "Create draft"}
              </button>

              <button
                className="primary"
                type="button"
                onClick={payByCard}
                disabled={creating !== false}
              >
                {creating === "checkout" ? "Starting checkout…" : "Pay by card"}
              </button>

              <button
                className="btn"
                type="button"
                onClick={createPaymentLink}
                disabled={creating !== false}
              >
                {creating === "plink" ? "Creating link…" : "Payment link"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
