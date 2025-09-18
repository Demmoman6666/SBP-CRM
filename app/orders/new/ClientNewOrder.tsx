// app/orders/new/ClientNewOrder.tsx  (your existing page logic, now as a Client Component)
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type Variant = {
  id: string | number;
  title: string;
  price?: string | number | null;
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
  price: number | null;
  quantity: number;
  sku?: string | null;
};

const SEARCH_ENDPOINT = "/api/shopify/products"; // expects ?q= query and returns products w/ variants

export default function ClientNewOrder() {
  const router = useRouter();
  const sp = useSearchParams();
  const customerId = sp.get("customerId") || "";
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
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
        // normalize into ProductHit[]
        const mapped: ProductHit[] = (Array.isArray(json) ? json : []).map((p: any) => ({
          id: String(p.id ?? ""),
          title: String(p.title ?? "-"),
          image: p.image?.src ? { src: p.image.src } : p.images?.[0]?.src ? { src: p.images[0].src } : null,
          variants: (p.variants ?? []).map((v: any) => ({
            id: String(v.id ?? ""),
            title: String(v.title ?? "Default"),
            price: v.price ?? v.compare_at_price ?? null,
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
  }, [query]);

  function addVariant(p: ProductHit, v: Variant) {
    const existingIdx = cart.findIndex((l) => l.variantId === String(v.id));
    if (existingIdx >= 0) {
      const next = [...cart];
      next[existingIdx].quantity += 1;
      setCart(next);
      return;
    }
    setCart((c) => [
      ...c,
      {
        variantId: String(v.id),
        productTitle: p.title,
        variantTitle: v.title,
        price: v.price == null ? null : Number(v.price),
        quantity: 1,
        sku: v.sku ?? null,
      },
    ]);
  }

  function updateQty(variantId: string, q: number) {
    const next = cart.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.max(1, q) } : l));
    setCart(next);
  }
  function removeLine(variantId: string) {
    setCart((c) => c.filter((l) => l.variantId !== variantId));
  }

  const subtotal = useMemo(() => {
    return cart.reduce((sum, l) => sum + (l.price ? l.price * l.quantity : 0), 0);
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

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Context row only (main H1 is in the wrapper) */}
      <section className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small muted">For customer ID: {customerId || "—"}</div>
        <a className="btn" href={customerId ? `/customers/${customerId}` : "/"}>Back</a>
      </section>

      <section className="card">
        <h3>Search Products</h3>
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
                    {p.variants.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        className="btn"
                        onClick={() => addVariant(p, v)}
                        disabled={v.available === false}
                        title={v.available === false ? "Not available" : "Add to order"}
                      >
                        {v.title} {v.sku ? `• ${v.sku}` : ""}{" "}
                        {v.price != null ? `• £${Number(v.price).toFixed(2)}` : ""}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h3>Cart</h3>
        {cart.length === 0 ? (
          <div className="small muted">No items yet.</div>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {cart.map((l) => (
              <div key={l.variantId} className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{l.productTitle}</div>
                  <div className="small muted">{l.variantTitle}{l.sku ? ` • ${l.sku}` : ""}</div>
                </div>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input
                    type="number"
                    min={1}
                    value={l.quantity}
                    onChange={(e) => updateQty(l.variantId, Number(e.target.value || 1))}
                    style={{ width: 70 }}
                  />
                  <div style={{ width: 90, textAlign: "right" }}>
                    {l.price != null ? `£${(l.price * l.quantity).toFixed(2)}` : "—"}
                  </div>
                  <button className="btn" type="button" onClick={() => removeLine(l.variantId)}>Remove</button>
                </div>
              </div>
            ))}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
              <div style={{ fontWeight: 700 }}>Subtotal: £{subtotal.toFixed(2)}</div>
            </div>
          </div>
        )}
      </section>

      <form onSubmit={onSubmit} className="right row" style={{ gap: 8 }}>
        {error && <div className="form-error" style={{ marginRight: "auto" }}>{error}</div>}
        <button className="primary" type="submit" disabled={submitting || cart.length === 0}>
          {submitting ? "Creating Draft Order…" : "Create Draft Order"}
        </button>
      </form>
    </div>
  );
}
