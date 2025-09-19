// components/ShopifyProductPicker.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type ApiVariant = {
  id: string | number;
  title: string;
  sku?: string | null;
  price: string | null;       // ex VAT (string from API)
  available?: boolean | null;
  stock?: number | null;      // live stock when available
};

type ApiProduct = {
  id: string | number;
  title: string;
  vendor?: string | null;
  image?: { src: string } | null;
  variants: ApiVariant[];
};

type PickedVariant = {
  variantId: number;
  productTitle: string;
  title: string;
  sku?: string | null;
  priceEx: number;
  image?: string | null;
};

type Props = {
  placeholder?: string;
  /** Called when a variant row is tapped/clicked */
  onPick: (v: PickedVariant) => void;
};

const VAT_RATE = Number(process.env.NEXT_PUBLIC_VAT_RATE ?? "0.20");

const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(
    Number.isFinite(n) ? n : 0
  );

export default function ShopifyProductPicker({ placeholder, onPick }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ApiProduct[]>([]);

  // debounce search
  useEffect(() => {
    const t = setTimeout(async () => {
      const term = q.trim();
      if (term.length < 2) {
        setRows([]);
        return;
      }
      setLoading(true);
      try {
        const r = await fetch(`/api/shopify/products?q=${encodeURIComponent(term)}`, {
          cache: "no-store",
        });
        if (r.ok) {
          const json = (await r.json()) as ApiProduct[];
          setRows(Array.isArray(json) ? json : []);
        } else {
          setRows([]);
        }
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // flatten to product → variants list
  const flat = useMemo(
    () =>
      rows.flatMap((p) =>
        (p.variants || []).map((v) => ({
          productTitle: p.title,
          productImage: p.image?.src ?? null,
          variantId: Number(v.id),
          variantTitle: v.title,
          sku: v.sku ?? null,
          priceEx: Number(v.price ?? 0),
          stock: typeof v.stock === "number" ? v.stock : null,
        }))
      ),
    [rows]
  );

  return (
    <div className="grid" style={{ gap: 10 }}>
      <input
        placeholder={placeholder ?? "Search by product title, SKU, vendor…"}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ height: 44 }}
      />

      {/* Results */}
      <div className="grid" style={{ gap: 6 }}>
        {loading && <div className="small muted">Searching…</div>}
        {!loading && q.trim().length >= 2 && flat.length === 0 && (
          <div className="small muted">No results.</div>
        )}

        {flat.map((r) => {
          const inc = r.priceEx * (1 + VAT_RATE);
          return (
            <button
              key={`${r.variantId}`}
              type="button"
              onClick={() =>
                onPick({
                  variantId: r.variantId,
                  productTitle: r.productTitle,
                  title: r.variantTitle,
                  sku: r.sku ?? undefined,
                  priceEx: r.priceEx,
                  image: r.productImage,
                })
              }
              className="btn"
              style={{
                // Shopify-like row (no pink)
                background: "#fff",
                borderColor: "var(--border)",
                textAlign: "left",
                display: "grid",
                gridTemplateColumns: "46px 1fr auto",
                alignItems: "center",
                gap: 12,
                padding: 10,
              }}
            >
              {/* image */}
              {r.productImage ? (
                <img
                  src={r.productImage}
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

              {/* titles */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.productTitle}
                </div>
                <div className="small muted" style={{ marginTop: 2 }}>
                  {r.sku ? `SKU ${r.sku}` : r.variantTitle}
                  {typeof r.stock === "number" ? ` • ${r.stock} available` : ""}
                </div>
              </div>

              {/* price (EX VAT) on the right */}
              <div className="small" style={{ justifySelf: "end", textAlign: "right" }}>
                <div>{money(r.priceEx)}</div>
                <div className="muted" style={{ fontSize: ".8rem" }}>
                  ({money(inc)} inc VAT)
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
