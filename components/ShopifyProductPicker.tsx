// components/ShopifyProductPicker.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type ApiVariant = {
  id: string | number;
  title: string;
  price: string | null;             // ex VAT (Shopify Admin scalar Money)
  sku?: string | null;
  available?: boolean | null;
  stock?: number | null;
  barcode?: string | null;
};

type ApiProduct = {
  id: string | number;
  title: string;
  vendor?: string | null;
  status?: string | null;
  image?: { src: string } | null;
  variants: ApiVariant[];
};

type PickValue = {
  variantId: number;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  priceExVat: number;               // numeric ex VAT
  stock: number | null;
  image: string | null;
};

type Props = {
  placeholder?: string;
  onPick: (v: PickValue) => void;
};

export default function ShopifyProductPicker({ placeholder, onPick }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ApiProduct[]>([]);

  // debounce user input
  useEffect(() => {
    const t = setTimeout(async () => {
      const term = q.trim();
      if (!term) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/shopify/products?q=${encodeURIComponent(term)}&first=15`, {
          cache: "no-store",
        });
        if (res.ok) {
          const json = (await res.json()) as ApiProduct[];
          setResults(Array.isArray(json) ? json : []);
        } else {
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const flat = useMemo(() => {
    const rows: Array<{ p: ApiProduct; v: ApiVariant }> = [];
    for (const p of results) {
      for (const v of p.variants || []) rows.push({ p, v });
    }
    return rows;
  }, [results]);

  return (
    <div className="grid" style={{ gap: 10 }}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder || "Search products…"}
        aria-label="Search products"
      />

      {/* results */}
      {q.trim() && (
        <div className="grid" style={{ gap: 8 }}>
          {loading && <div className="small muted">Searching…</div>}

          {!loading && flat.length === 0 && (
            <div className="small muted">No matches.</div>
          )}

          {!loading &&
            flat.map(({ p, v }) => {
              const priceExVat = Number(v.price ?? "0");
              const image = p.image?.src ?? null;
              return (
                <button
                  key={`${p.id}-${v.id}`}
                  type="button"
                  className="card"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "40px 1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: 10,
                    textAlign: "left",
                  }}
                  onClick={() =>
                    onPick({
                      variantId: Number(v.id),
                      productTitle: p.title,
                      variantTitle: v.title,
                      sku: v.sku ?? null,
                      priceExVat: Number.isFinite(priceExVat) ? priceExVat : 0,
                      stock: typeof v.stock === "number" ? v.stock : null,
                      image,
                    })
                  }
                >
                  {/* thumb */}
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "#fff",
                      display: "grid",
                      placeItems: "center",
                      overflow: "hidden",
                    }}
                  >
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div className="small muted">—</div>
                    )}
                  </div>

                  {/* text */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.title}
                    </div>
                    <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      SKU {v.sku || "—"}
                    </div>
                  </div>

                  {/* price/stock */}
                  <div className="small" style={{ textAlign: "right" }}>
                    {new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(
                      Number.isFinite(priceExVat) ? priceExVat : 0
                    )}
                    <div className="small muted">
                      {typeof v.stock === "number" ? `${v.stock} available` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
