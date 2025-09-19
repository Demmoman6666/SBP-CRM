// components/ShopifyProductPicker.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Variant = {
  id: string | number;
  title: string | null;
  price: string | null;           // string (Admin API scalar)
  sku?: string | null;
  available?: boolean | null;
  stock?: number | null;
};

type Product = {
  id: string | number;
  title: string;
  vendor?: string | null;
  image?: { src: string } | null;
  variants: Variant[];
};

type Props = {
  placeholder?: string;
  minChars?: number;              // default 2
  onAdd?: (variant: Variant & { productTitle: string }) => void;
  className?: string;
};

function money(n?: string | number | null, currency = "GBP") {
  if (n == null) return "—";
  const num = typeof n === "string" ? parseFloat(n) : Number(n);
  if (!Number.isFinite(num)) return String(n);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(num);
  } catch {
    return num.toFixed(2);
  }
}

function useDebounced<T>(value: T, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function ShopifyProductPicker({
  placeholder = "Search",
  minChars = 2,
  onAdd,
  className,
}: Props) {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 250);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Product[]>([]);
  const [open, setOpen] = useState(true);

  const controllerRef = useRef<AbortController | null>(null);

  const canSearch = debounced.trim().length >= minChars;

  const search = useCallback(async () => {
    if (!canSearch) {
      setResults([]);
      return;
    }
    try {
      setLoading(true);
      controllerRef.current?.abort();
      const ctl = new AbortController();
      controllerRef.current = ctl;

      const r = await fetch(
        `/api/shopify/products?q=${encodeURIComponent(debounced)}&first=20`,
        { signal: ctl.signal, cache: "no-store" }
      );
      if (!r.ok) throw new Error(String(r.status));
      const json = (await r.json()) as Product[];
      setResults(Array.isArray(json) ? json : []);
    } catch {
      // swallow
    } finally {
      setLoading(false);
    }
  }, [debounced, canSearch]);

  useEffect(() => { search(); /* eslint-disable-next-line */ }, [search]);

  const flatRows = useMemo(() => {
    // flatten products → variant rows, like Shopify does
    const rows: Array<{
      productId: string | number;
      productTitle: string;
      image?: string | null;
      variant: Variant;
    }> = [];
    for (const p of results) {
      for (const v of p.variants || []) {
        rows.push({
          productId: p.id,
          productTitle: p.title,
          image: p.image?.src || null,
          variant: v,
        });
      }
    }
    return rows;
  }, [results]);

  return (
    <div className={className}>
      {/* Header with show/hide toggle, Shopify-like */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Search Products</h3>
        <button
          type="button"
          className="primary"
          onClick={() => setOpen(s => !s)}
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <div className="card" style={{ marginTop: 12 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            aria-label="Search products"
          />

          {/* Hint / loading / empty states */}
          {!canSearch && q.length > 0 && (
            <p className="small muted" style={{ marginTop: 10 }}>
              Keep typing… ({minChars}+ characters)
            </p>
          )}
          {loading && (
            <p className="small muted" style={{ marginTop: 10 }}>Searching…</p>
          )}
          {canSearch && !loading && flatRows.length === 0 && (
            <p className="small muted" style={{ marginTop: 10 }}>No results.</p>
          )}

          {/* Results list (Shopify style) */}
          {flatRows.length > 0 && (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "12px 0 0 0",
              }}
            >
              {flatRows.map(({ productId, productTitle, image, variant }) => {
                const vTitle =
                  !variant.title || variant.title === "Default Title"
                    ? "" // hide "Default Title" like Shopify
                    : variant.title;

                const avail =
                  typeof variant.stock === "number"
                    ? `${variant.stock} available`
                    : variant.available === false
                      ? "0 available"
                      : undefined;

                return (
                  <li
                    key={`${productId}-${variant.id}`}
                    style={{
                      borderTop: "1px solid var(--border)",
                      padding: "10px 6px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onAdd?.({ ...variant, productTitle })}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "44px 1fr auto",
                        gap: 12,
                        width: "100%",
                        background: "transparent",
                        border: 0,
                        padding: 0,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      {/* Thumb */}
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 8,
                          overflow: "hidden",
                          border: "1px solid var(--border)",
                          background: "#fff",
                          display: "grid",
                          placeItems: "center",
                        }}
                      >
                        {image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={image}
                            alt=""
                            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover" }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 4,
                              background: "#eee",
                            }}
                          />
                        )}
                      </div>

                      {/* Text */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {productTitle}
                        </div>
                        <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {vTitle || (variant.sku ? `SKU ${variant.sku}` : "")}
                        </div>
                      </div>

                      {/* Price + stock (right-aligned), like Shopify */}
                      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 600 }}>{money(variant.price, "GBP")}</div>
                        {avail && <div className="small muted">• {avail}</div>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
