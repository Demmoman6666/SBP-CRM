// app/orders/new/ClientNewOrder.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Variant = {
  productGid: string;
  productId: string | null;
  productTitle: string;
  vendor: string | null;
  imageUrl: string | null;
  status: string | null;
  variantGid: string;
  variantId: string | null;
  variantTitle: string;
  sku: string | null;
  barcode: string | null;
  priceAmount: string | null;
  currencyCode: string | null;
  availableForSale: boolean | null;
  inventoryQuantity: number | null;
};

export default function ClientNewOrder() {
  const sp = useSearchParams();
  const customerId = sp.get("customerId");

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // simple cart: variantId -> qty
  const [cart, setCart] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!q || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        setLoading(true);
        setErr(null);
        const res = await fetch(`/api/shopify/products?query=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
      } catch (e: any) {
        if (!ac.signal.aborted) setErr(e?.message || "Search failed");
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [q]);

  const items = useMemo(
    () =>
      Object.entries(cart)
        .map(([variantId, qty]) => ({ variantId, quantity: qty }))
        .filter((x) => x.quantity > 0),
    [cart]
  );

  async function createDraft() {
    if (!customerId) {
      alert("Missing customerId");
      return;
    }
    if (items.length === 0) {
      alert("Add at least one item");
      return;
    }
    try {
      setErr(null);
      const res = await fetch("/api/orders/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, items }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to create draft order");

      // If your /api/orders/draft returns the invoice or admin URL, you can redirect:
      if (json?.invoice_url) window.open(json.invoice_url, "_blank");
      else if (json?.admin_url) window.open(json.admin_url, "_blank");
      else alert("Draft order created.");
    } catch (e: any) {
      setErr(e?.message || "Failed to create draft order");
    }
  }

  return (
    <section className="card grid" style={{ gap: 12 }}>
      {!customerId ? (
        <div className="small">
          <b>Missing customerId.</b> Use the “Create Order” button on a customer profile, which links to this page like:
          <br />
          <code>/orders/new?customerId=&lt;CRM_ID&gt;</code>
        </div>
      ) : (
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="small">
            For customer:{" "}
            <Link href={`/customers/${customerId}`} className="link">
              View profile
            </Link>
          </div>
          <button
            className="primary"
            onClick={createDraft}
            disabled={!items.length}
            title={items.length ? "" : "Add items to enable"}
          >
            Create Draft Order
          </button>
        </div>
      )}

      <div className="field">
        <label>Search products (title / SKU / vendor)</label>
        <input
          placeholder="e.g. shampoo, 12345, Wella"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>

      {err && <div className="form-error">{err}</div>}
      {loading && <div className="small muted">Searching…</div>}

      {/* Results */}
      <div className="grid" style={{ gap: 8 }}>
        {results.map((v) => {
          const id = v.variantId || v.variantGid;
          const qty = cart[id] || 0;
          return (
            <div
              key={v.variantGid}
              className="row"
              style={{ justifyContent: "space-between", border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}
            >
              <div className="row" style={{ gap: 10 }}>
                {v.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.imageUrl} alt="" width={48} height={48} style={{ objectFit: "cover", borderRadius: 8 }} />
                ) : (
                  <div style={{ width: 48, height: 48, background: "#f3f4f6", borderRadius: 8 }} />
                )}
                <div>
                  <div style={{ fontWeight: 600 }}>{v.productTitle}</div>
                  <div className="small muted">
                    {v.variantTitle !== "Default Title" ? v.variantTitle : ""}
                    {v.sku ? ` • SKU ${v.sku}` : ""}
                    {v.vendor ? ` • ${v.vendor}` : ""}
                    {v.priceAmount ? ` • ${v.priceAmount} ${v.currencyCode || ""}` : ""}
                  </div>
                </div>
              </div>

              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] || 0) - 1) }))}
                >
                  −
                </button>
                <input
                  value={qty}
                  onChange={(e) => {
                    const n = Math.max(0, Number(e.target.value) || 0);
                    setCart((c) => ({ ...c, [id]: n }));
                  }}
                  style={{ width: 56, textAlign: "center" }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }))}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cart summary */}
      <div className="card" style={{ padding: 10, borderRadius: 10, background: "#fafafa" }}>
        <b>Items</b>
        {items.length === 0 ? (
          <div className="small muted" style={{ marginTop: 6 }}>
            No items added yet.
          </div>
        ) : (
          <ul className="small" style={{ marginTop: 6 }}>
            {items.map((it) => (
              <li key={it.variantId}>
                {it.variantId}: ×{it.quantity}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
