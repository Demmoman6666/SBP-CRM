// app/orders/new/ClientNewOrder.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import ShopifyProductPicker from "@/components/ShopifyProductPicker";

type Customer = {
  id: string;
  salonName?: string | null;
  customerName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  town?: string | null;
  county?: string | null;
  postCode?: string | null;
  country?: string | null;
  customerTelephone?: string | null;
  customerEmailAddress?: string | null;
  shopifyCustomerId?: string | null;

  /** Optional (may not be present in initial props) */
  paymentDueLater?: boolean | null;
  paymentTermsName?: string | null;
  paymentTermsDueInDays?: number | null;
};

type CartLine = {
  variantId: number;
  productTitle: string;
  variantTitle?: string | null;
  sku?: string | null;
  unitExVat: number; // £ ex VAT
  /** live stock cap (null = unknown/no cap) */
  maxAvailable?: number | null;
};

type Props = { initialCustomer?: Customer | null };

const VAT_RATE = Number(process.env.NEXT_PUBLIC_VAT_RATE ?? "0.20");

// currency helper
const fmtGBP = (n: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(
    Number.isFinite(n) ? n : 0
  );
const to2 = (n: number) => Math.round(n * 100) / 100;

export default function ClientNewOrder({ initialCustomer }: Props) {
  const [customer, setCustomer] = useState<Customer | null>(initialCustomer ?? null);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [cart, setCart] = useState<Record<number, { line: CartLine; qty: number }>>({});
  const [creating, setCreating] = useState<false | "draft" | "checkout" | "plink" | "account">(false);

  // when a payment link is created, we show a panel instead of redirecting
  const [plink, setPlink] = useState<{ url: string; draftAdminUrl?: string | null } | null>(null);

  /** 🔹 Payment terms (hydrated from API when customer changes) */
  const [pt, setPt] = useState<{ enabled: boolean; name: string | null; dueInDays: number | null }>({
    enabled: !!initialCustomer?.paymentDueLater,
    name: initialCustomer?.paymentTermsName ?? null,
    dueInDays:
      typeof initialCustomer?.paymentTermsDueInDays === "number"
        ? (initialCustomer?.paymentTermsDueInDays as number)
        : null,
  });

  useEffect(() => {
    let abort = false;

    async function hydrateTerms(id: string) {
      try {
        const r = await fetch(`/api/customers/${encodeURIComponent(id)}/payment-terms`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!r.ok) {
          if (!abort) setPt({ enabled: false, name: null, dueInDays: null });
          return;
        }

        const j = await r.json().catch(() => ({}));
        if (abort) return;

        // Accept both the new keys and your existing legacy keys.
        const enabled =
          (typeof j?.enabled === "boolean" ? j.enabled : undefined) ??
          (typeof j?.paymentDueLater === "boolean" ? j.paymentDueLater : false);

        const name =
          (typeof j?.name === "string" && j.name.trim() ? j.name.trim() : undefined) ??
          (typeof j?.paymentTermsName === "string" && j.paymentTermsName.trim()
            ? j.paymentTermsName.trim()
            : null);

        const dueInDaysRaw =
          typeof j?.dueInDays === "number"
            ? j.dueInDays
            : typeof j?.paymentTermsDueInDays === "number"
            ? j.paymentTermsDueInDays
            : null;

        setPt({
          enabled: !!enabled,
          name,
          dueInDays: Number.isFinite(dueInDaysRaw as any) ? (dueInDaysRaw as number) : null,
        });
      } catch {
        if (!abort) setPt({ enabled: false, name: null, dueInDays: null });
      }
    }

    if (customer?.id) hydrateTerms(customer.id);
    return () => {
      abort = true;
    };
  }, [customer?.id]);

  // --- cart ops ---
  function addToCart(newLine: CartLine) {
    setCart((prev) => {
      const cur = prev[newLine.variantId];
      const cap = newLine.maxAvailable;
      // if we know it's out of stock, don't add
      if (cap != null && cap < 1) {
        alert("That item is out of stock.");
        return prev;
      }
      const nextQtyWanted = cur ? cur.qty + 1 : 1;
      const nextQty = cap != null ? Math.min(nextQtyWanted, Math.max(1, cap)) : nextQtyWanted;
      return { ...prev, [newLine.variantId]: { line: newLine, qty: nextQty } };
    });
  }

  function removeFromCart(variantId: number) {
    setCart((p) => {
      const { [variantId]: _, ...rest } = p;
      return rest;
    });
  }

  function setQty(variantId: number, qty: number) {
    setCart((prev) => {
      const item = prev[variantId];
      if (!item) return prev;
      const raw = Math.max(1, Math.floor(qty || 1));
      const cap = item.line.maxAvailable;
      const q = cap != null ? Math.min(raw, Math.max(1, cap)) : raw;
      return { ...prev, [variantId]: { ...item, qty: q } };
    });
  }

  // data sent to server for draft/stripe
  const simpleLines = useMemo(
    () =>
      Object.values(cart).map(({ line, qty }) => ({
        variantId: String(line.variantId),
        quantity: qty,
      })),
    [cart]
  );

  const totals = useMemo(() => {
    let ex = 0;
    for (const { line, qty } of Object.values(cart)) ex += line.unitExVat * qty;
    const tax = ex * VAT_RATE;
    const inc = ex + tax;
    return { ex: to2(ex), tax: to2(tax), inc: to2(inc) };
  }, [cart]);

  // hydrate missing stock for items already in cart
  useEffect(() => {
    const missing = Object.values(cart)
      .filter(({ line }) => line.maxAvailable == null || !Number.isFinite(Number(line.maxAvailable)))
      .map(({ line }) => line.variantId);

    if (missing.length === 0) return;

    (async () => {
      try {
        const r = await fetch("/api/shopify/variant-stock", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ids: missing }),
        });
        const j = await r.json().catch(() => ({}));
        const map = (j?.stock || {}) as Record<string, number>;
        if (!map || typeof map !== "object") return;

        setCart((prev) => {
          const next = { ...prev };
          for (const vidStr of Object.keys(map)) {
            const vid = Number(vidStr);
            const entry = next[vid];
            if (!entry) continue;
            const cap = Number(map[vidStr]);
            if (Number.isFinite(cap)) {
              entry.line = { ...entry.line, maxAvailable: cap };
              entry.qty = Math.min(entry.qty, Math.max(1, cap));
            }
          }
          return next;
        });
      } catch {
        /* ignore */
      }
    })();
  }, [cart]);

  // --- draft creation (normalizes payload on server) ---
  async function ensureDraft(
    { recreate = false, applyPaymentTerms = false }: { recreate?: boolean; applyPaymentTerms?: boolean } = {}
  ) {
    if (!customer?.id) throw new Error("Select a customer first.");
    if (simpleLines.length === 0) throw new Error("Add at least one line item to the cart.");
    setCreating("draft");
    try {
      const res = await fetch("/api/shopify/draft-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          recreate,
          customerId: customer.id,
          applyPaymentTerms, // 🔹 tell the API whether to attach payment_terms
          // send tolerant shapes so the API can pick whichever it prefers
          lines: simpleLines,
          draft_order_line_items: simpleLines.map((l) => ({
            variant_id: Number(l.variantId),
            quantity: Number(l.quantity),
          })),
          line_items: simpleLines.map((l) => ({
            variant_id: Number(l.variantId),
            quantity: Number(l.quantity),
          })),
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `Draft error ${res.status}`);
      const json = JSON.parse(text || "{}");
      const id: number | null =
        json?.id ??
        json?.draft_order?.id ??
        json?.draft?.id ??
        json?.draft?.draft_order?.id ??
        null;
      if (!id) throw new Error("Draft created but no id returned");
      setDraftId(id);
      return id;
    } finally {
      setCreating(false);
    }
  }

  // --- Stripe: Checkout (card) ---
  async function payByCard() {
    if (!customer?.id) return alert("Pick a customer first.");
    if (simpleLines.length === 0) return alert("Add at least one line item to the cart.");

    try {
      const id = await ensureDraft({ recreate: false, applyPaymentTerms: false });
      if (!id) throw new Error("Could not create draft order.");

      setCreating("checkout");
      const r = await fetch("/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          lines: simpleLines,
          note: `CRM Order for ${customer.salonName || customer.customerName || customer.id}`,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.url) throw new Error(j?.error || `Stripe Checkout failed: ${r.status}`);
      window.location.href = j.url as string;
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Stripe Checkout failed");
    } finally {
      setCreating(false);
    }
  }
  // --- Stripe: Payment Link (panel) ---
  async function createPaymentLink() {
    if (!customer?.id) return alert("Pick a customer first.");
    if (simpleLines.length === 0) return alert("Add at least one line item to the cart.");

    try {
      const id = await ensureDraft({ recreate: false, applyPaymentTerms: false });
      if (!id) throw new Error("Could not create draft order.");

      setCreating("plink");
      const r = await fetch("/api/payments/stripe/payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          lines: simpleLines,
          draftOrderId: id,
          note: `Payment link for ${customer.salonName || customer.customerName || customer.id}`,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.url) throw new Error(j?.error || `Payment Link failed: ${r.status}`);

      setPlink({ url: j.url as string, draftAdminUrl: j.draftAdminUrl || null });

      try {
        await navigator.clipboard.writeText(j.url as string);
      } catch {}
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Payment Link failed");
    } finally {
      setCreating(false);
    }
  }

  /** --- Pay on account (attach payment terms, then complete draft as payment pending) --- */
  async function payOnAccount() {
    if (!customer?.id) return alert("Pick a customer first.");
    if (simpleLines.length === 0) return alert("Add at least one line item to the cart.");
    if (!(pt.enabled && pt.name)) return alert("Customer has no payment terms enabled.");

    try {
      setCreating("account");
      // create/ensure draft with payment_terms attached
      const id = await ensureDraft({ recreate: false, applyPaymentTerms: true });
      if (!id) throw new Error("Could not create draft order.");

      // complete the draft as unpaid (payment pending)
      const r = await fetch("/api/shopify/draft-orders/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ draftId: id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `Complete draft failed: ${r.status}`);

      alert("Order placed on account successfully.");
      // Optionally redirect to order page if the API returns the order id
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Pay on account failed");
    } finally {
      setCreating(false);
    }
  }

  // --- UI blocks ---
  function CustomerBlock() {
    if (!customer) {
      return (
        <section className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <b>No customer selected</b>
              <div className="small muted">Pick a customer to start an order.</div>
            </div>
            <a className="primary" href="/customers?pick=1&return=/orders/new">
              Select customer
            </a>
          </div>
        </section>
      );
    }

    const address = [
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
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <div className="small muted">Customer</div>
            <div style={{ fontWeight: 800 }}>
              {customer.salonName || customer.customerName || "—"}
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {customer.customerName || ""}{" "}
              {customer.customerTelephone ? `• ${customer.customerTelephone}` : ""}{" "}
              {customer.customerEmailAddress ? `• ${customer.customerEmailAddress}` : ""}
            </div>
            <pre
              className="small muted"
              style={{ marginTop: 10, whiteSpace: "pre-wrap", lineHeight: 1.35 }}
            >
              {address || "—"}
            </pre>
          </div>
          <a className="btn" href="/customers?pick=1&return=/orders/new">
            Change customer
          </a>
        </div>
      </section>
    );
  }

  function CartBlock() {
    const rows = Object.values(cart);

    const canPayOnAccount =
      !!customer &&
      pt.enabled &&
      !!pt.name &&
      rows.length > 0 &&
      creating === false;

    return (
      <section className="card">
        <div className="small" style={{ fontWeight: 800, marginBottom: 8 }}>
          Cart
        </div>

        {rows.length === 0 && <div className="small muted">No items yet.</div>}

        {rows.map(({ line, qty }) => {
          const ex = to2(line.unitExVat * qty);
          const tax = to2(ex * VAT_RATE);
          const inc = to2(ex + tax);

          return (
            <div key={line.variantId} style={{ padding: "10px 0", borderTop: "1px solid #eee" }}>
              <div style={{ fontWeight: 700 }}>
                {line.productTitle}
                {line.variantTitle ? ` ${line.variantTitle}` : ""}
              </div>
              <div className="small muted">
                {line.sku ? `SKU: ${line.sku}` : ""}
                {line.maxAvailable != null ? ` • In stock: ${line.maxAvailable}` : ""}
              </div>

              <div className="small muted" style={{ marginTop: 6 }}>
                Ex VAT: {fmtGBP(ex)} &nbsp; • &nbsp; VAT ({Math.round(VAT_RATE * 100)}%):{" "}
                {fmtGBP(tax)} &nbsp; • &nbsp; Inc VAT: {fmtGBP(inc)}
              </div>

              <div className="row" style={{ marginTop: 8, gap: 10, alignItems: "center" }}>
                <div
                  style={{
                    border: "1px solid #111",
                    borderRadius: 14,
                    height: 36,
                    width: 90,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 600,
                  }}
                  title="Quantity"
                >
                  <input
                    aria-label="Quantity"
                    type="number"
                    min={1}
                    max={line.maxAvailable != null ? Math.max(1, line.maxAvailable) : undefined}
                    value={qty}
                    onChange={(e) => setQty(line.variantId, Number(e.target.value || 1))}
                    style={{
                      appearance: "textfield",
                      width: 68,
                      textAlign: "center",
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      fontWeight: 700,
                    }}
                  />
                </div>

                <button className="btn" type="button" onClick={() => removeFromCart(line.variantId)}>
                  Remove
                </button>
              </div>
            </div>
          );
        })}

        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="small muted">Net:</div>
            <div className="small">{fmtGBP(totals.ex)}</div>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="small muted">VAT ({Math.round(VAT_RATE * 100)}%):</div>
            <div className="small">{fmtGBP(totals.tax)}</div>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="small" style={{ fontWeight: 700 }}>
              Total:
            </div>
            <div className="small" style={{ fontWeight: 700 }}>
              {fmtGBP(totals.inc)}
            </div>
          </div>
        </div>

        <div
          className="row"
          style={{ marginTop: 14, gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}
        >
          <button
            className="btn"
            type="button"
            onClick={async () => {
              try {
                await ensureDraft({ recreate: true, applyPaymentTerms: false });
                alert("Draft created or refreshed.");
              } catch (err: any) {
                alert(err?.message || "Draft error");
              }
            }}
            disabled={creating !== false}
          >
            {creating === "draft" ? "Creating draft…" : draftId ? "Re-create draft" : "Create draft"}
          </button>

          <button className="primary" type="button" onClick={payByCard} disabled={creating !== false}>
            {creating === "checkout" ? "Starting checkout…" : "Pay by card"}
          </button>

          <button className="btn" type="button" onClick={createPaymentLink} disabled={creating !== false}>
            {creating === "plink" ? "Creating link…" : "Payment link"}
          </button>

          {/* 🔹 Pay on account */}
          <button
            className="btn"
            type="button"
            onClick={payOnAccount}
            disabled={
              !(
                !!customer &&
                pt.enabled &&
                !!pt.name &&
                Object.values(cart).length > 0 &&
                creating === false
              )
            }
            title={
              !!customer && pt.enabled && !!pt.name
                ? Object.values(cart).length > 0
                  ? "Create order on account"
                  : "Add at least one item"
                : "Enable payment terms on the customer to use Pay on account"
            }
            style={{
              opacity:
                !!customer && pt.enabled && !!pt.name && Object.values(cart).length > 0 && creating === false
                  ? 1
                  : 0.5,
              cursor:
                !!customer && pt.enabled && !!pt.name && Object.values(cart).length > 0 && creating === false
                  ? "pointer"
                  : "not-allowed",
            }}
          >
            {creating === "account" ? "Placing on account…" : "Pay on account"}
          </button>
        </div>
      </section>
    );
  }

  function PaymentLinkPanel() {
    if (!plink) return null;

    const message =
      `Thank you for your Salon Brands Pro order.\n\n` +
      `Your total is ${fmtGBP(totals.inc)}\n\n` +
      `Your payment link is:\n${plink.url}\n\n` +
      `Thank you ☺️`;

    async function copy(text: string) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {}
    }

    return (
      <section className="card" role="dialog" aria-labelledby="plink-title">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 id="plink-title" style={{ margin: 0 }}>Payment link created</h3>
          <button className="btn" type="button" onClick={() => setPlink(null)}>
            Done
          </button>
        </div>

        <div className="grid" style={{ gap: 10, marginTop: 12 }}>
          <div>
            <label>Link</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                readOnly
                value={plink.url}
                onFocus={(e) => e.currentTarget.select()}
                style={{ flex: 1 }}
              />
              <button className="btn" type="button" onClick={() => copy(plink.url)}>
                Copy link
              </button>
              <a className="btn" href={plink.url} target="_blank" rel="noreferrer">
                Open
              </a>
            </div>
          </div>

          <div>
            <label>Message</label>
            <textarea
              readOnly
              rows={5}
              value={message}
              onFocus={(e) => e.currentTarget.select()}
              style={{ width: "100%" }}
            />
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 8, gap: 8 }}>
              <button className="btn" type="button" onClick={() => copy(message)}>
                Copy message
              </button>
              {plink.draftAdminUrl && (
                <a className="btn" href={plink.draftAdminUrl} target="_blank" rel="noreferrer">
                  Open draft in Shopify
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <CustomerBlock />

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Search Products</h3>
        </div>

        <div style={{ marginTop: 12 }}>
          <ShopifyProductPicker
            placeholder="Search by product title, SKU, vendor…"
            onConfirm={(items: any[]) => {
              items.forEach((v) =>
                addToCart({
                  variantId: Number(v.variantId),
                  productTitle: v.productTitle,
                  variantTitle: v.variantTitle ?? null,
                  sku: v.sku ?? null,
                  unitExVat: Number.isFinite(v.priceExVat) ? Number(v.priceExVat) : 0,
                  maxAvailable: Number.isFinite(Number(v.available)) ? Number(v.available) : null,
                })
              );
            }}
          />
        </div>
      </section>

      <CartBlock />

      <PaymentLinkPanel />
    </div>
  );
}
