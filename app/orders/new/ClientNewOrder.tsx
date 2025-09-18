// app/orders/new/ClientNewOrder.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

/* ---------------- Types ---------------- */
type Variant = {
  id: string | number;
  title: string;
  price?: string | number | null; // net (ex VAT) from Shopify
  sku?: string | null;
  available?: boolean;
};
type ProductHit = {
  id: string | number;
  title: string;
  image?: { src?: string | null } | null;
  variants: Variant[];
};

type CartLine = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  priceNet: number | null; // store net price
  quantity: number;
  sku?: string | null;
};

type CustomerBrief = {
  id: string;
  salonName?: string | null;
  customerName?: string | null;
  customerTelephone?: string | null;
  customerEmailAddress?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  town?: string | null;
  county?: string | null;
  postCode?: string | null;
};

const SEARCH_ENDPOINT = "/api/shopify/products"; // ?q=
const VAT_RATE = 0.2;

/* ---------------- Helpers ---------------- */
function toNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function incVAT(net: number | null | undefined): number {
  if (!net && net !== 0) return 0;
  return +(net * (1 + VAT_RATE));
}
function fmt(n: number | null | undefined): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `£${x.toFixed(2)}`;
}
function addressLines(c?: CustomerBrief | null) {
  if (!c) return [];
  return [c.addressLine1, c.addressLine2, c.town, c.county, c.postCode]
    .filter(Boolean) as string[];
}

export default function ClientNewOrder() {
  const router = useRouter();
  const sp = useSearchParams();
  const customerId = sp.get("customerId") || "";

  /* Customer details */
  const [customer, setCustomer] = useState<CustomerBrief | null>(null);
  const [custErr, setCustErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setCustErr(null);
      setCustomer(null);
      if (!customerId) return;
      try {
        const res = await fetch(`/api/customers/${customerId}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load customer");
        const c: CustomerBrief = {
          id: json.id,
          salonName: json.salonName ?? null,
          customerName: json.customerName ?? null,
          customerTelephone: json.customerTelephone ?? null,
          customerEmailAddress: json.customerEmailAddress ?? null,
          addressLine1: json.addressLine1 ?? null,
          addressLine2: json.addressLine2 ?? null,
          town: json.town ?? null,
          county: json.county ?? null,
          postCode: json.postCode ?? null,
        };
        if (active) setCustomer(c);
      } catch (e: any) {
        if (active) setCustErr(e?.message || "Failed to load customer");
      }
    }
    load();
    return () => { active = false; };
  }, [customerId]);

  /* Search + cart */
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);

  // Hide search after first add; allow toggling back on
  const [showSearch, setShowSearch] = useState(true);

  useEffect(() => {
    if (!showSearch) return; // don't fetch when hidden
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        setLoading(true);
        const res = await fetch(`${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`, {
          signal: ac.signal,
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Search failed");
        const mapped: ProductHit[] = (Array.isArray(json) ? json : []).map((p: any) => ({
          id: String(p.id ?? ""),
          title: String(p.title ?? "-"),
          image: p.image?.src
            ? { src: p.image.src }
            : p.images?.[0]?.src
            ? { src: p.images[0].src }
            : null,
          variants: (p.variants ?? []).map((v: any) => ({
            id: String(v.id ?? ""),
            title: String(v.title ?? "Default"),
            price: v.price ?? v.compare_at_price ?? null, // net
            sku: v.sku ?? null,
            available: v.available ?? true,
          })),
        }));
        setHits(mapped);
      } catch (e: any) {
        if (e?.name !== "AbortError") setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [query, showSearch]);

  function addVariant(p: ProductHit, v: Variant) {
    const existingIdx = cart.findIndex((l) => l.variantId === String(v.id));
    if (existingIdx >= 0) {
      const next = [...cart];
      next[existingIdx].quantity += 1;
      setCart(next);
      setShowSearch(false);
      return;
    }
    setCart((c) => [
      ...c,
      {
        variantId: String(v.id),
        productTitle: p.title,
        variantTitle: v.title,
        priceNet: toNumber(v.price),
        quantity: 1,
        sku: v.sku ?? null,
      },
    ]);
    setShowSearch(false);
  }

  function updateQty(variantId: string, q: number) {
    const next = cart.map((l) =>
      l.variantId === variantId ? { ...l, quantity: Math.max(1, q) } : l
    );
    setCart(next);
  }
  function removeLine(variantId: string) {
    setCart((c) => c.filter((l) => l.variantId !== variantId));
  }

  const totals = useMemo(() => {
    const net = cart.reduce(
      (sum, l) => sum + (l.priceNet ? l.priceNet * l.quantity : 0),
      0
    );
    const vat = net * VAT_RATE;
    const gross = net + vat;
    return { net, vat, gross };
  }, [cart]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!customerId) {
      setError("Missing customerId. Click the Create Order button from a customer profile.");
      return;
    }
    if (cart.length === 0) {
      setError("Add at least one item to the order.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/orders/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          lines: cart.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to create draft order");

      if (json.invoiceUrl) window.open(json.invoiceUrl, "_blank");
      if (json.shopifyDraftOrderId && json.adminUrl) window.open(json.adminUrl, "_blank");

      router.push(`/customers/${customerId}`);
    } catch (err: any) {
      setError(err?.message || "Failed to create draft order");
    } finally {
      setSubmitting(false);
    }
  }

  // NEW: Pay by card via Stripe (robust JSON parsing to avoid "Unexpected end of JSON input")
  async function payByCard() {
    setError(null);

    if (!customerId) {
      setError("Missing customerId. Click the Create Order button from a customer profile.");
      return;
    }
    if (cart.length === 0) {
      setError("Add at least one item to the order.");
      return;
    }

    try {
      setPaying(true);
      const res = await fetch("/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          lines: cart.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        }),
      });

      // Parse safely (response might be empty on certain failures or redirects)
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // leave data as null; we’ll fall back to text
      }

      if (!res.ok) {
        const msg = (data && (data.error || data.message)) || text || "Stripe checkout failed";
        throw new Error(msg);
      }

      const url: string | undefined = data?.url;
      if (!url) throw new Error("Stripe did not return a checkout URL");
      // Redirect to Stripe Checkout
      window.location.href = url;
    } catch (err: any) {
      setError(err?.message || "Failed to start card payment");
    } finally {
      setPaying(false);
    }
  }

  return (
    <>
      {/* Back + who */}
      <section className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small muted">
          For customer ID:&nbsp;<b>{customerId || "—"}</b>
        </div>
        <a className="btn" href={customerId ? `/customers/${customerId}` : "/"}>Back</a>
      </section>

      {/* Customer details */}
      <section className="card">
        <b>Customer</b>
        {custErr ? (
          <p className="small" style={{ marginTop: 6, color: "var(--danger, #b91c1c)" }}>
            {custErr}
          </p>
        ) : !customerId ? (
          <p className="small" style={{ marginTop: 6 }}>—</p>
        ) : !customer ? (
          <p className="small muted" style={{ marginTop: 6 }}>Loading…</p>
        ) : (
          <div className="row" style={{ gap: 16, marginTop: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ minWidth: 220 }}>
              <div style={{ fontWeight: 600 }}>{customer.salonName || customer.customerName || "—"}</div>
              <div className="small muted">
                {customer.customerName || "—"}
                {customer.customerTelephone ? ` • ${customer.customerTelephone}` : ""}
                {customer.customerEmailAddress ? ` • ${customer.customerEmailAddress}` : ""}
              </div>
            </div>
            <div className="small" style={{ whiteSpace: "pre-line" }}>
              {addressLines(customer).length ? addressLines(customer).join("\n") : "—"}
            </div>
          </div>
        )}
      </section>

      {/* Search (auto-hide after first add) */}
      {showSearch ? (
        <section className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Search Products</h3>
            <button type="button" className="btn" onClick={() => setShowSearch(false)}>Hide</button>
          </div>
          <input
            placeholder="Search by product title, SKU, vendor…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {loading ? (
            <div className="small muted" style={{ marginTop: 8 }}>Searching…</div>
          ) : hits.length === 0 && query.trim() ? (
            <div className="small muted" style={{ marginTop: 8 }}>No results.</div>
          ) : (
            <div className="grid" style={{ gap: 8, marginTop: 10 }}>
              {hits.map((p) => (
                <div key={p.id} className="row" style={{ gap: 12, alignItems: "flex-start" }}>
                  {p.image?.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image.src!} alt="" width={48} height={48} style={{ borderRadius: 8, objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: 48, height: 48, background: "#f3f4f6", borderRadius: 8 }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{p.title}</div>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                      {p.variants.map((v) => {
                        const priceNet = toNumber(v.price) || 0;
                        const priceGross = incVAT(priceNet);
                        return (
                          <button
                            key={v.id}
                            type="button"
                            className="btn"
                            onClick={() => addVariant(p, v)}
                            disabled={v.available === false}
                            title={v.available === false ? "Not available" : "Add to order"}
                          >
                            {v.title}{v.sku ? ` • ${v.sku}` : ""} • {fmt(priceNet)} ex VAT{" "}
                            <span className="small muted">({fmt(priceGross)} inc VAT)</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" type="button" onClick={() => setShowSearch(true)}>
            Add more products
          </button>
        </div>
      )}

      {/* Cart */}
      <section className="card">
        <h3>Cart</h3>
        {cart.length === 0 ? (
          <div className="small muted">No items yet.</div>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {cart.map((l) => {
              const lineNet = l.priceNet ? l.priceNet * l.quantity : 0;
              const lineGross = incVAT(lineNet);
              return (
                <div key={l.variantId} className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{l.productTitle}</div>
                    <div className="small muted">
                      {l.variantTitle}{l.sku ? ` • ${l.sku}` : ""}
                    </div>
                    {/* Unit price: ex VAT primary, inc VAT underneath */}
                    <div className="small" style={{ marginTop: 2 }}>
                      Unit: {l.priceNet != null ? `${fmt(l.priceNet)} ex VAT` : "—"}
                    </div>
                    <div className="small muted" style={{ marginTop: 2 }}>
                      {l.priceNet != null ? `${fmt(incVAT(l.priceNet))} inc VAT` : ""}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) => updateQty(l.variantId, Number(e.target.value || 1))}
                      style={{ width: 70 }}
                    />
                    {/* Totals: ex VAT first, inc VAT underneath (swapped) */}
                    <div style={{ textAlign: "right" }}>
                      <div>{fmt(lineNet)} ex VAT</div>
                      <div className="small muted">{fmt(lineGross)} inc VAT</div>
                    </div>
                    <button className="btn" type="button" onClick={() => removeLine(l.variantId)}>Remove</button>
                  </div>
                </div>
              );
            })}

            <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
              <div style={{ textAlign: "right" }}>
                <div>Net: <b>{fmt(totals.net)}</b></div>
                <div>VAT (20%): <b>{fmt(totals.vat)}</b></div>
                <div style={{ fontWeight: 700, marginTop: 4 }}>Total: {fmt(totals.gross)} inc VAT</div>
              </div>
            </div>
            <div className="small muted" style={{ textAlign: "right" }}>
              Displayed totals include VAT. Shopify will calculate final tax on the draft order.
            </div>
          </div>
        )}
      </section>

      <form onSubmit={onSubmit} className="right row" style={{ gap: 8 }}>
        {error && <div className="form-error" style={{ marginRight: "auto" }}>{error}</div>}
        <button className="primary" type="submit" disabled={submitting || cart.length === 0}>
          {submitting ? "Creating Draft Order…" : "Create Draft Order"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={payByCard}
          disabled={paying || cart.length === 0}
          title="Take card payment via Stripe"
        >
          {paying ? "Starting card payment…" : "Pay by card"}
        </button>
      </form>
    </>
  );
}
